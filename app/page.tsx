"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FRONG_CONTRACT,
  TOKEN_CONTRACT,
  projectLinkList,
  projectLinks,
  projectLinkStatusLabel,
} from "./project-links";
import {
  aggregateEvidenceStatus,
  canonicalize,
  classifyTokenProvenance,
  compareExactSupply,
  detectEip1167Implementation,
  evaluateManifestIntegrity,
  formatTokenUnits,
  MANIFEST_SCHEMA,
  normalizeRpcQuantity,
  parseAbiUint256,
  parsePreparedTransaction,
  parseTokenDecimals,
  sha256Hex,
} from "./verifier-helpers";
import {
  type Eip6963ProviderDetail,
  type EvmProvider,
  type WalletOption,
  mergeWalletOptions,
  safeProviderError,
  toEip6963Wallet,
  walletInitials,
} from "./wallet-providers";

declare global {
  interface Window {
    ethereum?: EvmProvider;
    phantom?: {
      ethereum?: EvmProvider;
    };
  }
}

type Tab = "preflight" | "verify";
type CheckStatus = "confirmed" | "warning" | "unknown" | "mismatch";

type Check = {
  label: string;
  value: string;
  status: CheckStatus;
  detail: string;
};

type FormState = {
  tokenName: string;
  tokenSymbol: string;
  supply: string;
  beneficiary: string;
  treasury: string;
  website: string;
  xUrl: string;
  launchpad: string;
  transactionJson: string;
};

type StoredManifest = {
  schemaVersion: string;
  manifestId: string;
  createdAt: string;
  expiresAt: string;
  chainId: number;
  creator: string;
  launchpad: string;
  token: {
    name: string;
    symbol: string;
    expectedSupply: string;
  };
  recipients: {
    beneficiary: string;
    treasury: string;
  };
  links: {
    website: string;
    x: string;
  };
  transaction: {
    to: string;
    value: string;
    data: string;
    chainId: number | null;
    sha256: string;
  };
  declarations: {
    additionalMint: "unknown";
    proxy: "unknown";
    lpOwner: "unknown";
  };
  checks: Check[];
  manifestHash: string;
  signature?: string;
};

type VerifyRow = {
  label: string;
  expected?: string;
  actual: string;
  status: CheckStatus;
  detail: string;
};

const ROBINHOOD_CHAIN_ID = 4663;
const ROBINHOOD_CHAIN_HEX = "0x1237";
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

const INITIAL_FORM: FormState = {
  tokenName: "",
  tokenSymbol: "",
  supply: "",
  beneficiary: "",
  treasury: "",
  website: "",
  xUrl: "",
  launchpad: "",
  transactionJson: "",
};

const STATUS_COPY: Record<CheckStatus, string> = {
  confirmed: "Confirmed",
  warning: "Warning",
  unknown: "Unknown",
  mismatch: "Mismatch",
};

const isAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value.trim());
const shortAddress = (value: string) =>
  isAddress(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || "Not set";

const normalizeHex = (value?: string) => (value || "0x").toLowerCase();

function collectLegacyProviders() {
  const candidates: EvmProvider[] = [];
  const injected = window.ethereum;
  if (Array.isArray(injected?.providers)) candidates.push(...injected.providers);
  if (injected?.isMetaMask) candidates.push(injected);
  if (window.phantom?.ethereum) candidates.push(window.phantom.ethereum);
  if (injected) candidates.push(injected);
  return [...new Set(candidates)];
}

function decodeAbiString(hex?: string | null) {
  if (!hex || hex === "0x") return null;
  try {
    const clean = hex.slice(2);
    if (clean.length === 64) {
      const bytes = clean.match(/.{2}/g) || [];
      const decoded = new TextDecoder().decode(
        new Uint8Array(bytes.map((part) => Number.parseInt(part, 16))),
      );
      return decoded.replace(/\0+$/g, "").trim() || null;
    }
    const offset = Number.parseInt(clean.slice(0, 64), 16) * 2;
    const length = Number.parseInt(clean.slice(offset, offset + 64), 16) * 2;
    const data = clean.slice(offset + 64, offset + 64 + length);
    const bytes = data.match(/.{2}/g) || [];
    return new TextDecoder().decode(
      new Uint8Array(bytes.map((part) => Number.parseInt(part, 16))),
    );
  } catch {
    return null;
  }
}

function decodeAddress(hex?: string | null) {
  if (!hex || hex.length < 42) return null;
  const address = `0x${hex.slice(-40)}`;
  return !isAddress(address) || address.toLowerCase() === ZERO_ADDRESS ? null : address;
}

async function rpcCall<T>(
  method: string,
  params: unknown[],
  fallbackProvider?: EvmProvider | null,
): Promise<T> {
  try {
    const response = await fetch(PUBLIC_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    if (!response.ok) throw new Error(`RPC ${response.status}`);
    const payload = (await response.json()) as { result?: T; error?: { message?: string } };
    if (payload.error) throw new Error(payload.error.message || "RPC error");
    return payload.result as T;
  } catch (error) {
    if (fallbackProvider) {
      const walletChain = (await fallbackProvider.request({ method: "eth_chainId" })) as string;
      if (walletChain.toLowerCase() !== ROBINHOOD_CHAIN_HEX) {
        throw new Error(
          `Wallet fallback blocked: switch the wallet to Robinhood Chain (${ROBINHOOD_CHAIN_HEX}).`,
        );
      }
      return (await fallbackProvider.request({ method, params })) as T;
    }
    throw error;
  }
}

async function safeRpcCall<T>(
  method: string,
  params: unknown[],
  fallbackProvider?: EvmProvider | null,
): Promise<T | null> {
  try {
    return await rpcCall<T>(method, params, fallbackProvider);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Wallet fallback blocked:")) throw error;
    return null;
  }
}

async function readContract(
  address: string,
  data: string,
  blockTag: string,
  fallbackProvider?: EvmProvider | null,
) {
  return safeRpcCall<string>("eth_call", [{ to: address, data }, blockTag], fallbackProvider);
}

function StatusPill({ status }: { status: CheckStatus }) {
  return <span className={`status-pill status-${status}`}>{STATUS_COPY[status]}</span>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className={mono ? "mono-input" : ""}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("preflight");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [account, setAccount] = useState("");
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [manifest, setManifest] = useState<StoredManifest | null>(null);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [txHash, setTxHash] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [verifyRows, setVerifyRows] = useState<VerifyRow[]>([]);
  const [verifyMeta, setVerifyMeta] = useState({ block: "", from: "", to: "" });
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<Pick<WalletOption, "id" | "name"> | null>(null);
  const selectedProviderRef = useRef<EvmProvider | null>(null);
  const walletDialogRef = useRef<HTMLDivElement | null>(null);

  const update = (field: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const clearSelectedWallet = useCallback((message?: string) => {
    selectedProviderRef.current = null;
    setSelectedWallet(null);
    setAccount("");
    setWalletChainId(null);
    if (message) setNotice(message);
  }, []);

  const rescanWallets = useCallback(() => {
    const legacyProviders = collectLegacyProviders();
    setWalletOptions((current) =>
      mergeWalletOptions(
        current.filter((wallet) => wallet.source === "eip6963"),
        legacyProviders,
      ),
    );
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const selected = selectedProviderRef.current;
    if (selected) {
      void selected.request({ method: "eth_chainId" }).catch(() => {
        if (selectedProviderRef.current === selected) {
          clearSelectedWallet("The selected wallet disconnected. Choose a wallet again.");
        }
      });
    }
  }, [clearSelectedWallet]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem("recipeint:manifest");
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as StoredManifest;
          setManifest(parsed);
          setSignature(parsed.signature || "");
        } catch {
          window.localStorage.removeItem("recipeint:manifest");
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleAnnouncement = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      const announced = toEip6963Wallet(detail);
      if (!announced) return;
      setWalletOptions((current) => {
        const eip6963 = current.filter(
          (wallet) => wallet.source === "eip6963" && wallet.id !== announced.id,
        );
        return mergeWalletOptions([...eip6963, announced], collectLegacyProviders());
      });
    };

    window.addEventListener("eip6963:announceProvider", handleAnnouncement);
    const discoveryTimer = window.setTimeout(rescanWallets, 0);
    return () => {
      window.clearTimeout(discoveryTimer);
      window.removeEventListener("eip6963:announceProvider", handleAnnouncement);
    };
  }, [rescanWallets]);

  useEffect(() => {
    const provider = selectedProviderRef.current;
    if (!selectedWallet || !provider?.on) return;
    const handleAccounts = (...args: unknown[]) => {
      const accounts = (args[0] || []) as string[];
      if (selectedProviderRef.current !== provider) return;
      if (!isAddress(accounts[0] || "")) {
        clearSelectedWallet("The selected wallet disconnected. Choose a wallet again.");
        return;
      }
      setAccount(accounts[0]);
    };
    const handleChain = (...args: unknown[]) => {
      if (selectedProviderRef.current !== provider) return;
      const chain = String(args[0] || "0x0");
      setWalletChainId(Number.parseInt(chain, 16));
    };
    const handleDisconnect = () => {
      if (selectedProviderRef.current === provider) {
        clearSelectedWallet("The selected wallet disconnected. Choose a wallet again.");
      }
    };
    provider.on("accountsChanged", handleAccounts);
    provider.on("chainChanged", handleChain);
    provider.on("disconnect", handleDisconnect);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
      provider.removeListener?.("chainChanged", handleChain);
      provider.removeListener?.("disconnect", handleDisconnect);
    };
  }, [clearSelectedWallet, selectedWallet]);

  useEffect(() => {
    if (!walletModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWalletModalOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    walletDialogRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [walletModalOpen]);

  const transaction = useMemo(
    () => parsePreparedTransaction(form.transactionJson),
    [form.transactionJson],
  );

  const checks = useMemo<Check[]>(() => {
    const result: Check[] = [];
    result.push({
      label: "Network",
      value:
        walletChainId === null
          ? "Wallet not connected"
          : walletChainId === ROBINHOOD_CHAIN_ID
            ? "Robinhood Chain · 4663"
            : `Wrong chain · ${walletChainId}`,
      status:
        walletChainId === null
          ? "unknown"
          : walletChainId === ROBINHOOD_CHAIN_ID
            ? "confirmed"
            : "mismatch",
      detail: "The launch must be signed on chain ID 4663.",
    });
    result.push({
      label: "Creator",
      value: account ? shortAddress(account) : "Connect wallet",
      status: account ? "confirmed" : "unknown",
      detail: "This wallet will sign the disclosure manifest.",
    });
    result.push({
      label: "Token identity",
      value:
        form.tokenName && form.tokenSymbol
          ? `${form.tokenName} · $${form.tokenSymbol.toUpperCase()}`
          : "Incomplete",
      status:
        !form.tokenName || !form.tokenSymbol
          ? "unknown"
          : "unknown",
      detail: "Creator declaration recorded; name and ticker are not onchain proof.",
    });
    result.push({
      label: "Expected supply",
      value: /^(0|[1-9][0-9]*)$/.test(form.supply.replace(/,/g, ""))
        ? BigInt(form.supply.replace(/,/g, "")).toLocaleString("en-US")
        : "Not set",
      status:
        !form.supply
          ? "unknown"
          : /^[1-9][0-9]*$/.test(form.supply.replace(/,/g, ""))
            ? "unknown"
            : "mismatch",
      detail: "Creator declaration only; exact raw totalSupply will be checked after deployment.",
    });
    result.push({
      label: "Fee recipient",
      value: shortAddress(form.beneficiary),
      status: form.beneficiary && !isAddress(form.beneficiary) ? "mismatch" : "unknown",
      detail: "Creator declaration only. The launch transaction must still prove the fee route.",
    });
    result.push({
      label: "Treasury",
      value: shortAddress(form.treasury),
      status: form.treasury && !isAddress(form.treasury) ? "mismatch" : "unknown",
      detail: "Creator declaration only. The launch transaction must still prove the treasury route.",
    });
    result.push({
      label: "Prepared transaction",
      value:
        transaction && "error" in transaction
          ? "Invalid JSON"
          : transaction
            ? shortAddress(transaction.to)
            : "Not attached",
      status:
        transaction && "error" in transaction
          ? "mismatch"
          : transaction
            ? !isAddress(transaction.to)
              ? "mismatch"
              : !transaction.chainIdProvided || transaction.chainId === null
                ? "unknown"
                : transaction.chainId === ROBINHOOD_CHAIN_ID
                  ? "unknown"
                  : "mismatch"
            : "unknown",
      detail:
        transaction && !("error" in transaction) && !transaction.chainIdProvided
          ? "chainId is missing. The creator declaration cannot prove Robinhood Chain."
          : "Paste the wallet transaction request to bind the manifest to exact calldata.",
    });
    result.push({
      label: "Additional mint",
      value: "Not proven before deployment",
      status: "unknown",
      detail: "No-mint can only be confirmed from deployed bytecode and admin paths.",
    });
    result.push({
      label: "Proxy / admin",
      value: "Pending deployment",
      status: "unknown",
      detail: "EIP-1967 implementation and admin slots are checked after launch.",
    });
    return result;
  }, [account, form, transaction, walletChainId]);

  const counts = useMemo(
    () =>
      checks.reduce(
        (totals, check) => ({ ...totals, [check.status]: totals[check.status] + 1 }),
        { confirmed: 0, warning: 0, unknown: 0, mismatch: 0 } as Record<CheckStatus, number>,
      ),
    [checks],
  );

  const overall = counts.mismatch
    ? { label: "Mismatch found", status: "mismatch" as CheckStatus }
    : counts.warning
      ? { label: "Review warnings", status: "warning" as CheckStatus }
      : counts.unknown
        ? { label: "Evidence incomplete", status: "unknown" as CheckStatus }
        : checks.length
          ? { label: "Manifest ready", status: "confirmed" as CheckStatus }
          : { label: "Complete intent", status: "unknown" as CheckStatus };

  function connectWallet() {
    rescanWallets();
    setWalletModalOpen(true);
  }

  async function selectWallet(wallet: WalletOption) {
    setBusy("connect");
    try {
      const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
      const chainHex = (await wallet.provider.request({ method: "eth_chainId" })) as string;
      const chainId = Number.parseInt(chainHex, 16);
      if (!Array.isArray(accounts) || !isAddress(accounts[0] || "")) {
        throw new Error("Selected provider returned no EVM account.");
      }
      if (!Number.isSafeInteger(chainId)) throw new Error("Selected provider returned no chain ID.");
      selectedProviderRef.current = wallet.provider;
      setSelectedWallet({ id: wallet.id, name: wallet.name });
      setAccount(accounts[0]);
      setWalletChainId(chainId);
      setWalletModalOpen(false);
      setNotice(`${wallet.name} connected. No approvals or transactions were requested.`);
    } catch (error) {
      setNotice(safeProviderError(error));
    } finally {
      setBusy("");
    }
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("recipeint:theme", next);
  }

  async function copyTokenContract() {
    if (!TOKEN_CONTRACT) return;
    try {
      await navigator.clipboard.writeText(TOKEN_CONTRACT);
      setNotice("Token contract copied.");
    } catch {
      setNotice("Clipboard access was blocked. Copy the contract from Blockscout.");
    }
  }

  async function switchNetwork() {
    const provider = selectedProviderRef.current;
    if (!provider) {
      connectWallet();
      return;
    }
    setBusy("network");
    try {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ROBINHOOD_CHAIN_HEX }],
        });
      } catch {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: ROBINHOOD_CHAIN_HEX,
              chainName: "Robinhood Chain",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [PUBLIC_RPC],
              blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
            },
          ],
        });
      }
      setWalletChainId(ROBINHOOD_CHAIN_ID);
      setNotice("Robinhood Chain selected.");
    } catch (error) {
      setNotice(safeProviderError(error));
    } finally {
      setBusy("");
    }
  }

  async function generateManifest() {
    if (!account || walletChainId !== ROBINHOOD_CHAIN_ID) {
      setNotice("Connect the creator wallet on Robinhood Chain first.");
      return;
    }
    if (!form.tokenName || !form.tokenSymbol || !form.supply) {
      setNotice("Token name, ticker and expected supply are required.");
      return;
    }
    if (!/^[1-9][0-9]*$/.test(form.supply.replace(/,/g, ""))) {
      setNotice("Expected supply must be a positive whole number.");
      return;
    }
    if (counts.mismatch) {
      setNotice("Resolve mismatches before generating a manifest.");
      return;
    }
    setBusy("manifest");
    try {
      const tx = transaction && !("error" in transaction) ? transaction : null;
      const txPayload = {
        to: tx?.to || "",
        value: tx?.value || "0x0",
        data: tx?.data || "0x",
        chainId: tx?.chainId ?? null,
      };
      const txHashValue = await sha256Hex(canonicalize(txPayload));
      const now = new Date();
      const base = {
        schemaVersion: MANIFEST_SCHEMA,
        manifestId: crypto.randomUUID(),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        chainId: ROBINHOOD_CHAIN_ID,
        creator: account,
        launchpad: form.launchpad,
        token: {
          name: form.tokenName.trim(),
          symbol: form.tokenSymbol.trim().toUpperCase(),
          expectedSupply: form.supply.replace(/,/g, ""),
        },
        recipients: {
          beneficiary: form.beneficiary.trim(),
          treasury: form.treasury.trim(),
        },
        links: { website: form.website.trim(), x: form.xUrl.trim() },
        transaction: { ...txPayload, sha256: txHashValue },
        declarations: {
          additionalMint: "unknown" as const,
          proxy: "unknown" as const,
          lpOwner: "unknown" as const,
        },
        checks,
      };
      const manifestHash = await sha256Hex(canonicalize(base));
      const nextManifest: StoredManifest = { ...base, manifestHash };
      setManifest(nextManifest);
      setSignature("");
      window.localStorage.setItem("recipeint:manifest", JSON.stringify(nextManifest));
      setNotice("Manifest generated locally. It has not been signed or uploaded.");
    } finally {
      setBusy("");
    }
  }

  async function signManifest() {
    const provider = selectedProviderRef.current;
    if (!manifest || !provider || !account) {
      setNotice("Generate a manifest and connect the creator wallet first.");
      return;
    }
    if (manifest.creator.toLowerCase() !== account.toLowerCase()) {
      setNotice("Connected wallet changed. Generate a new manifest before signing.");
      return;
    }
    setBusy("sign");
    try {
      const typedData = {
        domain: {
          name: "RECIPEINT Launch Manifest",
          version: "0.1",
          chainId: ROBINHOOD_CHAIN_ID,
        },
        primaryType: "LaunchManifest",
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
          ],
          LaunchManifest: [
            { name: "manifestHash", type: "bytes32" },
            { name: "manifestId", type: "string" },
            { name: "creator", type: "address" },
            { name: "tokenName", type: "string" },
            { name: "tokenSymbol", type: "string" },
            { name: "transactionHash", type: "bytes32" },
            { name: "expiresAt", type: "string" },
          ],
        },
        message: {
          manifestHash: manifest.manifestHash,
          manifestId: manifest.manifestId,
          creator: account,
          tokenName: manifest.token.name,
          tokenSymbol: manifest.token.symbol,
          transactionHash: manifest.transaction.sha256,
          expiresAt: manifest.expiresAt,
        },
      };
      const signed = (await provider.request({
        method: "eth_signTypedData_v4",
        params: [account, JSON.stringify(typedData)],
      })) as string;
      const signedManifest = { ...manifest, signature: signed };
      setManifest(signedManifest);
      setSignature(signed);
      window.localStorage.setItem("recipeint:manifest", JSON.stringify(signedManifest));
      setNotice("Manifest signed. This was a message signature—not a token approval or transaction.");
    } catch (error) {
      setNotice(safeProviderError(error));
    } finally {
      setBusy("");
    }
  }

  function downloadManifest() {
    if (!manifest) return;
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${manifest.token.symbol.toLowerCase()}-recipeint-manifest.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setNotice(`${label} copied.`);
  }

  async function verifyLaunch() {
    const transactionHash = txHash.trim();
    const suppliedToken = tokenAddress.trim();
    const hasTransaction = Boolean(transactionHash);
    const hasToken = Boolean(suppliedToken);
    if (!hasTransaction && !hasToken) {
      setNotice("Enter a transaction hash or token contract address.");
      return;
    }
    if (hasTransaction && !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
      setNotice("Enter a valid 32-byte transaction hash, or leave it empty for token-only inspection.");
      return;
    }
    if (hasToken && !isAddress(suppliedToken)) {
      setNotice("Enter a valid 20-byte token contract address.");
      return;
    }

    setBusy("verify");
    setVerifyRows([]);
    try {
      const walletFallback = selectedProviderRef.current;
      const rows: VerifyRow[] = [];
      const integrity = await evaluateManifestIntegrity(
        manifest ? (manifest as unknown as Record<string, unknown>) : null,
      );
      rows.push({ label: "Manifest integrity", ...integrity });

      let tx: Record<string, string> | null = null;
      let receipt: Record<string, string> | null = null;
      let blockTag = "latest";

      if (hasTransaction) {
        [tx, receipt] = await Promise.all([
          rpcCall<Record<string, string> | null>(
            "eth_getTransactionByHash",
            [transactionHash],
            walletFallback,
          ),
          rpcCall<Record<string, string> | null>(
            "eth_getTransactionReceipt",
            [transactionHash],
            walletFallback,
          ),
        ]);
        if (!tx || !receipt) throw new Error("Transaction was not found or is not yet indexed.");
        blockTag = receipt.blockNumber || "latest";

        const succeeded = receipt.status === "0x1";
        rows.push({
          label: "Transaction execution",
          actual: succeeded ? "Succeeded" : "Reverted",
          status: succeeded ? "confirmed" : "mismatch",
          detail: succeeded
            ? `Included at evidence block ${blockTag}.`
            : "No launch state should be trusted from a reverted transaction.",
        });
        const onchainChainId = normalizeRpcQuantity(tx.chainId);
        const declaredChainId = manifest?.transaction.chainId;
        rows.push({
          label: "Transaction chain ID",
          expected: declaredChainId === null || declaredChainId === undefined ? undefined : String(declaredChainId),
          actual: onchainChainId === null ? "Missing" : onchainChainId.toString(),
          status:
            onchainChainId === null || declaredChainId === null || declaredChainId === undefined
              ? "unknown"
              : onchainChainId !== BigInt(ROBINHOOD_CHAIN_ID) || declaredChainId !== ROBINHOOD_CHAIN_ID
                ? "mismatch"
                : "confirmed",
          detail: "Missing chainId remains Unknown; an explicit non-4663 value is a mismatch.",
        });
        rows.push({
          label: "Creator wallet",
          expected: manifest?.creator,
          actual: tx.from || "Unknown",
          status:
            !manifest?.creator || !tx.from
              ? "unknown"
              : tx.from.toLowerCase() === manifest.creator.toLowerCase()
                ? "confirmed"
                : "mismatch",
          detail: "Compared with the creator declaration. Signature recovery is not performed here.",
        });
        rows.push({
          label: "Transaction target",
          expected: manifest?.transaction.to || undefined,
          actual: tx.to || "Contract creation",
          status:
            manifest?.transaction.to && tx.to
              ? tx.to.toLowerCase() === manifest.transaction.to.toLowerCase()
                ? "confirmed"
                : "mismatch"
              : "unknown",
          detail: "A target mismatch can redirect otherwise identical calldata.",
        });
        rows.push({
          label: "Transaction calldata",
          expected: manifest?.transaction.data
            ? `${manifest.transaction.data.slice(0, 18)}…`
            : undefined,
          actual: tx.input ? `${tx.input.slice(0, 18)}…` : "0x",
          status: manifest?.transaction.data
            ? normalizeHex(tx.input) === normalizeHex(manifest.transaction.data)
              ? "confirmed"
              : "mismatch"
            : "unknown",
          detail: "Exact byte-for-byte comparison with the prepared transaction.",
        });
        const expectedValue = normalizeRpcQuantity(manifest?.transaction.value);
        const actualValue = normalizeRpcQuantity(tx.value);
        rows.push({
          label: "Transaction value",
          expected: manifest?.transaction.value,
          actual: tx.value || "Unreadable",
          status:
            expectedValue === null || actualValue === null
              ? "unknown"
              : expectedValue === actualValue
                ? "confirmed"
                : "mismatch",
          detail: "Exact native-token value comparison; hidden value changes can alter launch economics.",
        });
      } else {
        rows.push({
          label: "Launch transaction",
          actual: "Not provided",
          status: "unknown",
          detail: "Token-only inspection uses latest state and cannot prove the launch transaction.",
        });
      }

      const provenance = classifyTokenProvenance({
        hasTransaction,
        receiptContractAddress: receipt?.contractAddress,
        providedTokenAddress: suppliedToken,
      });
      rows.push({ label: "Token provenance", ...provenance });

      const deployedToken = provenance.inspectionAddress || "";
      if (isAddress(deployedToken)) {
        const [
          nameHex,
          symbolHex,
          decimalsHex,
          supplyHex,
          ownerHex,
          code,
          implementationHex,
          adminHex,
          beaconHex,
        ] = await Promise.all([
          readContract(deployedToken, "0x06fdde03", blockTag, walletFallback),
          readContract(deployedToken, "0x95d89b41", blockTag, walletFallback),
          readContract(deployedToken, "0x313ce567", blockTag, walletFallback),
          readContract(deployedToken, "0x18160ddd", blockTag, walletFallback),
          readContract(deployedToken, "0x8da5cb5b", blockTag, walletFallback),
          safeRpcCall<string>("eth_getCode", [deployedToken, blockTag], walletFallback),
          safeRpcCall<string>(
            "eth_getStorageAt",
            [deployedToken, EIP1967_IMPLEMENTATION_SLOT, blockTag],
            walletFallback,
          ),
          safeRpcCall<string>(
            "eth_getStorageAt",
            [deployedToken, EIP1967_ADMIN_SLOT, blockTag],
            walletFallback,
          ),
          safeRpcCall<string>(
            "eth_getStorageAt",
            [deployedToken, EIP1967_BEACON_SLOT, blockTag],
            walletFallback,
          ),
        ]);
        const name = decodeAbiString(nameHex);
        const symbol = decodeAbiString(symbolHex);
        const decimals = parseTokenDecimals(decimalsHex);
        const rawSupply = parseAbiUint256(supplyHex);
        const supplyComparison = compareExactSupply(
          manifest?.token.expectedSupply,
          supplyHex,
          decimals,
        );
        const owner = decodeAddress(ownerHex);
        const implementation = decodeAddress(implementationHex);
        const admin = decodeAddress(adminHex);
        const beacon = decodeAddress(beaconHex);
        const minimalProxy = detectEip1167Implementation(code);
        const evidenceLabel = blockTag === "latest" ? "latest state" : `block ${blockTag}`;

        rows.push({
          label: "Token bytecode",
          actual: code && code !== "0x" ? `${(code.length - 2) / 2} bytes deployed` : "No bytecode",
          status: code === null ? "unknown" : code !== "0x" ? "confirmed" : "mismatch",
          detail: `Read from ${shortAddress(deployedToken)} at ${evidenceLabel}.`,
        });
        rows.push({
          label: "Token name",
          expected: manifest?.token.name,
          actual: name || "Unreadable",
          status: !name
            ? "unknown"
            : manifest?.token.name
              ? name === manifest.token.name
                ? "confirmed"
                : "mismatch"
              : "unknown",
          detail: `name() at ${evidenceLabel}.`,
        });
        rows.push({
          label: "Token ticker",
          expected: manifest?.token.symbol,
          actual: symbol || "Unreadable",
          status: !symbol
            ? "unknown"
            : manifest?.token.symbol
              ? symbol === manifest.token.symbol
                ? "confirmed"
                : "mismatch"
              : "unknown",
          detail: `symbol() at ${evidenceLabel}.`,
        });
        rows.push({
          label: "Token decimals",
          actual: decimals === null ? "Unreadable or unreasonable" : String(decimals),
          status: decimals === null ? "unknown" : "confirmed",
          detail: `decimals() at ${evidenceLabel}; values above 77 are rejected as unreasonable.`,
        });
        rows.push({
          label: "Total supply",
          expected: manifest?.token.expectedSupply,
          actual:
            rawSupply !== null && decimals !== null
              ? `${formatTokenUnits(rawSupply, decimals)} tokens · raw ${rawSupply.toString()}`
              : rawSupply !== null
                ? `raw ${rawSupply.toString()} · decimals unreadable`
                : "Unreadable",
          status: supplyComparison.status,
          detail: `${supplyComparison.detail} Evidence: ${evidenceLabel}.`,
        });
        rows.push({
          label: "Owner",
          actual: owner || "No standard owner() detected",
          status: owner ? "warning" : "unknown",
          detail: owner
            ? "A live owner may retain privileged control. Inspect its callable functions."
            : "A failed or empty owner() read does not prove absence of admin roles.",
        });

        const proxyParts = [
          minimalProxy ? `EIP-1167 implementation ${shortAddress(minimalProxy)}` : "",
          implementation ? `EIP-1967 implementation ${shortAddress(implementation)}` : "",
          beacon ? `EIP-1967 beacon ${shortAddress(beacon)}` : "",
          admin ? `EIP-1967 admin ${shortAddress(admin)}` : "",
        ].filter(Boolean);
        rows.push({
          label: "Proxy detection",
          actual: proxyParts.length ? proxyParts.join(" · ") : "No standard proxy detected",
          status: proxyParts.length ? "warning" : "unknown",
          detail: proxyParts.length
            ? `Standard runtime/slots indicate upgrade or delegation paths at ${evidenceLabel}.`
            : "Empty standard slots and no EIP-1167 pattern do not prove the contract is non-upgradeable.",
        });
      } else {
        rows.push({
          label: "Token contract",
          actual: "Not provided",
          status: "unknown",
          detail: "Supply a token address to inspect deployed code and token state.",
        });
      }

      setVerifyRows(rows);
      setVerifyMeta({
        block:
          blockTag === "latest"
            ? "latest"
            : (normalizeRpcQuantity(blockTag)?.toLocaleString("en-US") ?? blockTag),
        from: tx?.from || "",
        to: tx?.to || "",
      });
      setNotice("Evidence read from Robinhood Chain. Review every Unknown and Warning manually.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to read Robinhood Chain evidence.");
    } finally {
      setBusy("");
    }
  }

  const verifyOverall = aggregateEvidenceStatus(verifyRows);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="RECIPEINT home">
          <span className="brand-mark">R</span>
          <span className="brand-word">RECIP<span>EI</span>NT</span>
          <span className="brand-version">v0.1</span>
        </a>
        <nav className="header-nav" aria-label="Primary navigation">
          <a href="#method">Method</a>
          <a href="#distribution">50 / 50</a>
          <a href="https://blog.uniswap.org/uniswap-history" target="_blank" rel="noreferrer">
            Origin story ↗
          </a>
        </nav>
        <div className="header-actions">
          <div className="header-socials" aria-label="Project and display controls">
            {[projectLinks.x, projectLinks.telegram].map((link) =>
              link.href ? (
                <a key={link.label} href={link.href} target="_blank" rel="noreferrer" aria-label={`Open ${link.label}`}>
                  {link.shortLabel === "Telegram" ? "TG" : link.shortLabel}
                </a>
              ) : (
                <button key={link.label} type="button" disabled aria-label={`${link.label} coming soon`} title="Coming soon">
                  {link.shortLabel === "Telegram" ? "TG" : link.shortLabel}
                </button>
              ),
            )}
            <button
              className="theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              title="Toggle color theme"
            >
              <span className="theme-icon-dark" aria-hidden="true">☀</span>
              <span className="theme-icon-light" aria-hidden="true">☾</span>
            </button>
          </div>
          <button
            className="wallet-button"
            onClick={connectWallet}
            disabled={busy === "connect"}
            aria-label={account && selectedWallet ? `${selectedWallet.name}, ${shortAddress(account)}. Choose another wallet` : busy === "connect" ? "Connecting wallet" : "Choose wallet"}
          >
            <span className={account ? "wallet-dot connected" : "wallet-dot"} />
            <span className="wallet-label">{account && selectedWallet ? <><strong>{selectedWallet.name}</strong><small>{shortAddress(account)}</small></> : busy === "connect" ? "Connecting…" : "Choose wallet"}</span>
          </button>
        </div>
      </header>

      {walletModalOpen ? (
        <div
          className="wallet-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setWalletModalOpen(false);
          }}
        >
          <div
            className="wallet-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-dialog-title"
            aria-describedby="wallet-dialog-description"
            tabIndex={-1}
            ref={walletDialogRef}
          >
            <div className="wallet-dialog-head">
              <div>
                <span className="section-index">INJECTED EVM WALLETS</span>
                <h2 id="wallet-dialog-title">Choose your wallet</h2>
              </div>
              <button
                className="wallet-dialog-close"
                type="button"
                onClick={() => setWalletModalOpen(false)}
                aria-label="Close wallet chooser"
              >
                ×
              </button>
            </div>
            <p id="wallet-dialog-description" className="wallet-dialog-copy">
              Select the exact provider for every wallet request. Names and domains are self-attested
              metadata, not proof of identity.
            </p>
            <p className="wallet-trust-note">
              Wallet names are reported by browser extensions. Confirm the popup belongs to the wallet you selected.
            </p>

            {walletOptions.length ? (
              <div className="wallet-option-list" aria-label="Detected EVM wallets">
                {walletOptions.map((wallet) => (
                  <button
                    key={wallet.id}
                    className="wallet-option"
                    type="button"
                    onClick={() => selectWallet(wallet)}
                    disabled={busy === "connect"}
                    aria-label={`Connect ${wallet.name}`}
                  >
                    <span className="wallet-option-icon" aria-hidden="true">
                      {wallet.icon ? (
                        // EIP-6963 icons are runtime data URIs and cannot use the Next image optimizer.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={wallet.icon} alt="" />
                      ) : walletInitials(wallet.name)}
                    </span>
                    <span className="wallet-option-copy">
                      <strong>{wallet.name}</strong>
                      <small>{wallet.rdns}</small>
                    </span>
                    <span className="wallet-option-action">
                      {selectedWallet?.id === wallet.id ? "Connected" : "Connect"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="wallet-empty">
                <strong>No injected EVM wallets detected</strong>
                <p>Install an EVM browser wallet, then refresh this list. WalletConnect is not used.</p>
                <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                  Install MetaMask ↗
                </a>
              </div>
            )}

            <div className="wallet-dialog-foot">
              <button className="wallet-rescan" type="button" onClick={rescanWallets}>
                Refresh / rescan
              </button>
              <small>Only the wallet you choose receives subsequent requests.</small>
            </div>
          </div>
        </div>
      ) : null}

      <section className="hero" id="top">
        <div className="eyebrow"><span>Creator-side security</span><span>Robinhood Chain · 4663</span></div>
        <h1>Catch the mismatch<br />before the <em>signature.</em></h1>
        <p>
          Turn launch intent into a wallet-signed manifest. Then compare it with the transaction and
          deployed token—field by field, never with a fake “safe” score.
        </p>
        <div className="hero-proof">
          <span className="proof-line" />
          <p><strong>RECIPEINT</strong> is the typo Vitalik caught before Uniswap launched. Now it catches launch mistakes.</p>
        </div>
        <div className="project-link-rail" aria-label="Official project links">
          <span className="link-rail-label">Official links</span>
          {projectLinkList.map((link) => {
            if (link === projectLinks.token) {
              return (
                <div key={link.label} className="project-contract-control">
                  {link.href ? (
                    <a href={link.href} target="_blank" rel="noreferrer">
                      <span>{link.shortLabel}</span>
                      <strong>CA: {TOKEN_CONTRACT ? shortAddress(TOKEN_CONTRACT) : "After launch"} ↗</strong>
                    </a>
                  ) : (
                    <span className="project-contract-pending" aria-disabled="true">
                      <span>{link.shortLabel}</span>
                      <strong>CA: After launch</strong>
                    </span>
                  )}
                  <button
                    className="ca-copy"
                    type="button"
                    onClick={copyTokenContract}
                    disabled={!TOKEN_CONTRACT}
                    aria-label={TOKEN_CONTRACT ? "Copy token contract" : "Token contract available after launch"}
                    title={TOKEN_CONTRACT ? "Copy contract address" : "After launch"}
                  >
                    COPY
                  </button>
                </div>
              );
            }
            return link.href ? (
              <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
                <span>{link.shortLabel}</span>
                <strong>{projectLinkStatusLabel[link.status]} ↗</strong>
              </a>
            ) : (
              <span key={link.label} className="project-link-disabled" aria-disabled="true">
                <span>{link.shortLabel}</span>
                <strong>{projectLinkStatusLabel[link.status]}</strong>
              </span>
            );
          })}
        </div>
      </section>

      <section className="workbench" aria-label="RECIPEINT launch workbench">
        <div className="workbench-head">
          <div className="tabs" role="tablist" aria-label="Preflight modes">
            <button
              className={activeTab === "preflight" ? "active" : ""}
              onClick={() => setActiveTab("preflight")}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight") return;
                event.preventDefault();
                setActiveTab("verify");
                (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.focus();
              }}
              role="tab"
              id="preflight-tab"
              aria-controls="preflight-panel"
              aria-selected={activeTab === "preflight"}
              tabIndex={activeTab === "preflight" ? 0 : -1}
            >
              <span>01</span> Preflight intent
            </button>
            <button
              className={activeTab === "verify" ? "active" : ""}
              onClick={() => setActiveTab("verify")}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft") return;
                event.preventDefault();
                setActiveTab("preflight");
                (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus();
              }}
              role="tab"
              id="verify-tab"
              aria-controls="verify-panel"
              aria-selected={activeTab === "verify"}
              tabIndex={activeTab === "verify" ? 0 : -1}
            >
              <span>02</span> Verify launch
            </button>
          </div>
          <div className="privacy-note"><span>●</span> Runs locally · no keys collected</div>
        </div>

        {activeTab === "preflight" ? (
          <div className="workbench-grid" role="tabpanel" id="preflight-panel" aria-labelledby="preflight-tab">
            <div className="intent-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-index">01 / INTENT</span>
                  <h2>Declare the launch</h2>
                </div>
                <span className="step-state">Draft</span>
              </div>

              <div className="network-card">
                <div>
                  <span className="network-orb">R</span>
                  <div><strong>Robinhood Chain</strong><small>Chain ID 4663 · ETH gas</small></div>
                </div>
                {walletChainId === ROBINHOOD_CHAIN_ID ? (
                  <StatusPill status="confirmed" />
                ) : (
                  <button className="text-button" onClick={switchNetwork} disabled={busy === "network"}>
                    {busy === "network" ? "Switching…" : "Switch network"}
                  </button>
                )}
              </div>

              <div className="field-grid two">
                <Field label="Token name" value={form.tokenName} onChange={(value) => update("tokenName", value)} placeholder="e.g. Example Token" />
                <Field label="Ticker" value={form.tokenSymbol} onChange={(value) => update("tokenSymbol", value.toUpperCase())} placeholder="e.g. TKN" hint="Use a short, unique ticker supported by the selected launchpad." />
              </div>
              <Field label="Expected total supply" value={form.supply} onChange={(value) => update("supply", value.replace(/[^0-9,]/g, ""))} placeholder="e.g. 1000000000" mono />
              <div className="field-grid two">
                <Field label="Fee beneficiary" value={form.beneficiary} onChange={(value) => update("beneficiary", value)} placeholder="0x…" mono />
                <Field label="Treasury" value={form.treasury} onChange={(value) => update("treasury", value)} placeholder="0x…" mono />
              </div>
              <div className="field-grid two">
                <Field label="Website" value={form.website} onChange={(value) => update("website", value)} placeholder="https://…" />
                <Field label="X profile" value={form.xUrl} onChange={(value) => update("xUrl", value)} placeholder="https://x.com/…" />
              </div>
              <Field label="Launchpad" value={form.launchpad} onChange={(value) => update("launchpad", value)} placeholder="Enter launchpad name or URL" />

              <label className="field transaction-field">
                <span className="field-label">Prepared transaction JSON <span>optional until the transaction is prepared</span></span>
                <textarea
                  value={form.transactionJson}
                  onChange={(event) => update("transactionJson", event.target.value)}
                  placeholder={'{"to":"0x…","value":"0x0","data":"0x…","chainId":"0x1237"}'}
                  spellCheck={false}
                />
                <span className="field-hint">Binds the manifest to the exact factory, value and calldata your wallet will sign.</span>
              </label>

              <div className="action-stack">
                <button className="primary-action" onClick={generateManifest} disabled={busy === "manifest"}>
                  <span>{busy === "manifest" ? "Generating…" : "Generate launch manifest"}</span><span>→</span>
                </button>
                <p>No transaction is sent. The manifest stays on this device until you download it.</p>
              </div>
            </div>

            <aside className="result-panel">
              <div className="result-card">
                <div className="receipt-top">
                  <div><span className="receipt-kicker">RECIPEINT PREFLIGHT</span><strong>{form.tokenName || "NO TOKEN PROVIDED"}</strong><small>{form.tokenSymbol ? `$${form.tokenSymbol}` : "Ticker not provided"} · {form.launchpad || "Launchpad not provided"}</small></div>
                  <div className="stamp">R<span>✓</span></div>
                </div>

                <div className="overall-row">
                  <div><span>Overall status</span><strong>{overall.label}</strong></div>
                  <StatusPill status={overall.status} />
                </div>

                <div className="status-summary">
                  <span className="confirmed-dot">{counts.confirmed} confirmed</span>
                  <span className="warning-dot">{counts.warning} warning</span>
                  <span className="unknown-dot">{counts.unknown} unknown</span>
                  <span className="mismatch-dot">{counts.mismatch} mismatch</span>
                </div>

                <div className="checks-list">
                  {checks.map((check) => (
                    <details key={check.label} className={`check-row check-${check.status}`}>
                      <summary>
                        <span className="check-icon" aria-hidden="true" />
                        <span><strong>{check.label}</strong><small>{check.value}</small></span>
                        <StatusPill status={check.status} />
                      </summary>
                      <p>{check.detail}</p>
                    </details>
                  ))}
                </div>

                <div className="manifest-box">
                  <div className="manifest-head"><span>Local launch manifest</span>{signature ? <span className="unsigned">Signature present</span> : <span className="unsigned">Unsigned</span>}</div>
                  {manifest ? (
                    <>
                      <button className="hash-row" onClick={() => copyText(manifest.manifestHash, "Manifest hash")}>
                        <span>SHA-256</span><code>{manifest.manifestHash.slice(0, 18)}…{manifest.manifestHash.slice(-8)}</code><span>Copy</span>
                      </button>
                      <div className="manifest-meta"><span>Expires</span><strong>{new Date(manifest.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong><span>Creator</span><strong>{shortAddress(manifest.creator)}</strong></div>
                      <div className="manifest-actions">
                        <button className="sign-button" onClick={signManifest} disabled={busy === "sign" || Boolean(signature)}>{signature ? "Manifest signed" : busy === "sign" ? "Check wallet…" : "Sign with wallet"}</button>
                        <button className="download-button" onClick={downloadManifest}>Download JSON</button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-manifest"><span>∴</span><p>Complete the intent and generate a manifest. The creator signature will lock these values.</p></div>
                  )}
                </div>

                <p className="result-disclaimer">A confirmed field means “matched,” not “safe.” Unknown fields require manual review.</p>
              </div>
            </aside>
          </div>
        ) : (
          <div className="verify-layout" role="tabpanel" id="verify-panel" aria-labelledby="verify-tab">
            <div className="verify-input-panel">
              <span className="section-index">02 / ONCHAIN MATCH</span>
              <h2>Verify what actually launched</h2>
              <p>Inspect a launch transaction, a token contract, or both. Token-only checks use latest state and cannot prove launch provenance.</p>
              <Field label="Launch transaction hash (optional)" value={txHash} onChange={setTxHash} placeholder="0x…" mono />
              <Field label="Token contract (optional)" value={tokenAddress} onChange={setTokenAddress} placeholder="0x…" mono hint="For factory launches, this enables inspection but does not prove which transaction created the token." />
              <button className="primary-action verify-action" onClick={verifyLaunch} disabled={busy === "verify"}>
                <span>{busy === "verify" ? "Reading Robinhood Chain…" : "Verify launch"}</span><span>→</span>
              </button>
              <div className="saved-manifest-card">
                <span>Local comparison manifest</span>
                {manifest ? <><strong>{manifest.token.name} · ${manifest.token.symbol}</strong><small>{signature ? "Signature present · not recovery-validated" : "Unsigned"} · {manifest.manifestHash.slice(0, 14)}…</small></> : <><strong>No manifest saved</strong><small>Onchain inspection will still work, but intended values remain Unknown.</small></>}
              </div>
            </div>

            <div className="verify-result-panel">
              {verifyRows.length ? (
                <>
                  <div className="verify-result-head">
                    <div><span className="receipt-kicker">ONCHAIN RESULT</span><h3>{verifyOverall.label}</h3><p>Evidence: {verifyMeta.block === "latest" ? "latest state" : `block ${verifyMeta.block}`}{verifyMeta.from || verifyMeta.to ? ` · ${shortAddress(verifyMeta.from)} → ${shortAddress(verifyMeta.to)}` : ""}</p></div>
                    <StatusPill status={verifyOverall.status} />
                  </div>
                  <div className="verify-table">
                    {verifyRows.map((row) => (
                      <details key={row.label} className={`verify-row check-${row.status}`}>
                        <summary><span className="check-icon" /><span><strong>{row.label}</strong><small>{row.actual}</small></span><StatusPill status={row.status} /></summary>
                        <div>{row.expected ? <p><span>Expected</span>{row.expected}</p> : null}<p><span>Evidence</span>{row.detail}</p></div>
                      </details>
                    ))}
                  </div>
                </>
              ) : (
                <div className="verify-empty">
                  <div className="scan-grid" aria-hidden="true"><span /><span /><span /><span /><i /></div>
                  <h3>No evidence loaded</h3>
                  <p>Paste a Robinhood Chain transaction hash or token address to inspect execution, token state and standard proxy patterns.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {notice ? <button className="toast" onClick={() => setNotice("")} aria-label="Dismiss notification" aria-live="polite"><span>{notice}</span><span>×</span></button> : null}

      <section className="distribution-section" id="distribution" aria-labelledby="distribution-title">
        <div className="distribution-intro">
          <span className="section-index">DECLARED FEE ROUTE / PREVIEW</span>
          <h2 id="distribution-title">Half to FRONG.<br /><em>Half to build.</em></h2>
          <p>
            A transparent allocation policy for creator and LP fees actually collected by the project.
            No APY, yield, or payout is promised.
          </p>
        </div>

        <div className="fee-split" aria-label="Planned fee allocation">
          <article className="split-card community-card">
            <div className="split-card-top">
              <span className="split-number">50<span>%</span></span>
              <span className="split-tag">FRONG COMMUNITY</span>
            </div>
            <h3>Periodic Merkle claims</h3>
            <p>
              50% of creator and LP fees actually collected are intended for periodic claims by
              eligible FRONG holders, calculated from disclosed snapshot data.
            </p>
            <a className="contract-link" href={projectLinks.frong.href ?? undefined} target="_blank" rel="noreferrer">
              <span>Eligibility token</span>
              <code>{FRONG_CONTRACT}</code>
              <strong>Blockscout ↗</strong>
            </a>
          </article>

          <article className="split-card build-card">
            <div className="split-card-top">
              <span className="split-number">50<span>%</span></span>
              <span className="split-tag">BUILD TREASURY</span>
            </div>
            <h3>Public project development</h3>
            <p>
              50% are intended for product and security, team compensation, disclosed marketing,
              listings and Dexscreener, token burns, and other strategic project spending.
            </p>
            <ul className="treasury-uses" aria-label="Planned treasury uses">
              <li>Product + security</li>
              <li>Team</li>
              <li>Marketing + listings</li>
              <li>Burns + strategy</li>
            </ul>
          </article>
        </div>

        <aside className="claim-preview" aria-labelledby="claim-title">
          <div className="claim-status-column">
            <span className="live-status"><i aria-hidden="true" /> Not live</span>
            <span className="claim-sequence">DISTRIBUTION / 000</span>
          </div>
          <div className="claim-copy">
            <span className="section-index">COMMUNITY CLAIM</span>
            <h3 id="claim-title">Claim surface preview</h3>
            <p>No rewards are funded and no snapshot has been published. This panel will activate only after a verifiable distribution root is live.</p>
          </div>
          <dl className="claim-metrics">
            <div><dt>Rewards funded</dt><dd>0</dd></div>
            <div><dt>Snapshot</dt><dd>Not published</dd></div>
            <div><dt>Merkle root</dt><dd>Not published</dd></div>
          </dl>
          <button className="claim-button" type="button" disabled>
            <span>Claim after launch</span><span aria-hidden="true">—</span>
          </button>
        </aside>

        <p className="distribution-disclaimer">
          Amounts depend on fees actually collected and may vary or be zero. Eligibility rules,
          snapshot blocks, Merkle roots, treasury addresses, and transactions should be published
          before each distribution.
        </p>
      </section>

      <section className="method-section" id="method">
        <div className="method-intro"><span className="section-index">HOW IT WORKS</span><h2>One launch.<br />Three sources of truth.</h2><p>RECIPEINT does not invent a score. It preserves intent, inspects execution and points to the exact evidence.</p></div>
        <div className="method-steps">
          <article><span>01</span><div><h3>Declare</h3><p>Creator records supply, recipients, links and prepared transaction data.</p></div></article>
          <article><span>02</span><div><h3>Sign</h3><p>An EIP-712 signature binds the manifest to the creator wallet and chain.</p></div></article>
          <article><span>03</span><div><h3>Match</h3><p>The launch receipt and deployed state are compared field by field.</p></div></article>
        </div>
      </section>

      <section className="limits-section">
        <div><span className="limits-mark">!</span><h2>What this does not prove</h2></div>
        <div className="limits-grid"><p>Not a smart contract audit</p><p>Not a safety certification</p><p>Not an endorsement of a creator</p><p>Not investment advice</p></div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">R</span><span className="brand-word">RECIP<span>EI</span>NT</span></div>
        <p>Independent creator-side preflight infrastructure. No affiliation with Uniswap Labs, pools.trade, Robinhood or Vitalik Buterin.</p>
        <div className="footer-links">
          {projectLinkList.map((link) =>
            link.href ? (
              <a key={link.label} href={link.href} target="_blank" rel="noreferrer">{link.shortLabel} ↗</a>
            ) : (
              <span key={link.label} aria-disabled="true">{link.shortLabel} · {projectLinkStatusLabel[link.status]}</span>
            ),
          )}
        </div>
      </footer>
    </main>
  );
}
