"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FRONG_CONTRACT,
  projectLinkList,
  projectLinks,
  projectLinkStatusLabel,
} from "./project-links";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
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
    chainId: number;
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
  "0xb53127684a568b3173ae13b9f8a6016e0190000000000000000000000000000";

const INITIAL_FORM: FormState = {
  tokenName: "RECIPEINT",
  tokenSymbol: "RCPNT",
  supply: "1000000000",
  beneficiary: "",
  treasury: "",
  website: "",
  xUrl: "",
  launchpad: "pools.trade",
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

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(input: string) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return `0x${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseTransaction(input: string) {
  if (!input.trim()) return null;
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const rawChain = parsed.chainId;
    const chainId =
      typeof rawChain === "string"
        ? rawChain.startsWith("0x")
          ? Number.parseInt(rawChain, 16)
          : Number.parseInt(rawChain, 10)
        : typeof rawChain === "number"
          ? rawChain
          : ROBINHOOD_CHAIN_ID;
    return {
      to: typeof parsed.to === "string" ? parsed.to : "",
      from: typeof parsed.from === "string" ? parsed.from : "",
      value: typeof parsed.value === "string" ? parsed.value : "0x0",
      data:
        typeof parsed.data === "string"
          ? parsed.data
          : typeof parsed.input === "string"
            ? parsed.input
            : "0x",
      chainId,
    };
  } catch {
    return { error: true } as const;
  }
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
  return address.toLowerCase() === ZERO_ADDRESS ? null : address;
}

function formatUnits(raw: bigint, decimals: number) {
  if (decimals === 0) return raw.toLocaleString("en-US");
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction.slice(0, 6)}` : ""}`;
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
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
    if (window.ethereum) {
      return (await window.ethereum.request({ method, params })) as T;
    }
    throw error;
  }
}

async function readContract(address: string, data: string) {
  try {
    return await rpcCall<string>("eth_call", [{ to: address, data }, "latest"]);
  } catch {
    return null;
  }
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

  const update = (field: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

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
    if (!window.ethereum?.on) return;
    const handleAccounts = (...args: unknown[]) => {
      const accounts = (args[0] || []) as string[];
      setAccount(accounts[0] || "");
    };
    const handleChain = (...args: unknown[]) => {
      const chain = String(args[0] || "0x0");
      setWalletChainId(Number.parseInt(chain, 16));
    };
    window.ethereum.on("accountsChanged", handleAccounts);
    window.ethereum.on("chainChanged", handleChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccounts);
      window.ethereum?.removeListener?.("chainChanged", handleChain);
    };
  }, []);

  const transaction = useMemo(() => parseTransaction(form.transactionJson), [form.transactionJson]);

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
          : form.tokenSymbol.toUpperCase() === "RCPT"
            ? "warning"
            : "confirmed",
      detail:
        form.tokenSymbol.toUpperCase() === "RCPT"
          ? "$RCPT already collides with several Robinhood Chain tokens. Use $RCPNT."
          : "Name and ticker are creator-declared until matched onchain.",
    });
    result.push({
      label: "Expected supply",
      value: form.supply ? Number(form.supply.replace(/,/g, "")).toLocaleString("en-US") : "Not set",
      status: Number(form.supply.replace(/,/g, "")) > 0 ? "confirmed" : "unknown",
      detail: "Actual totalSupply will be checked after deployment.",
    });
    result.push({
      label: "Fee recipient",
      value: shortAddress(form.beneficiary),
      status: isAddress(form.beneficiary) ? "confirmed" : "unknown",
      detail: "Prevents creator fees from silently routing to the wrong wallet.",
    });
    result.push({
      label: "Treasury",
      value: shortAddress(form.treasury),
      status: isAddress(form.treasury) ? "confirmed" : "unknown",
      detail: "Keep treasury separate from the deployer wallet.",
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
            ? transaction.chainId === ROBINHOOD_CHAIN_ID && isAddress(transaction.to)
              ? "confirmed"
              : "mismatch"
            : "unknown",
      detail: "Paste the wallet transaction request to bind the manifest to exact calldata.",
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
      : account && walletChainId === ROBINHOOD_CHAIN_ID && form.tokenName && form.tokenSymbol
        ? { label: "Manifest ready", status: "confirmed" as CheckStatus }
        : { label: "Complete intent", status: "unknown" as CheckStatus };

  async function connectWallet() {
    if (!window.ethereum) {
      setNotice("No EVM wallet detected. Install a wallet extension and refresh.");
      return;
    }
    setBusy("connect");
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const chainHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      setAccount(accounts[0] || "");
      setWalletChainId(Number.parseInt(chainHex, 16));
      setNotice("Wallet connected. No approvals or transactions were requested.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Wallet connection was rejected.");
    } finally {
      setBusy("");
    }
  }

  async function switchNetwork() {
    if (!window.ethereum) return connectWallet();
    setBusy("network");
    try {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ROBINHOOD_CHAIN_HEX }],
        });
      } catch {
        await window.ethereum.request({
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
      setNotice(error instanceof Error ? error.message : "Network switch was rejected.");
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
        chainId: tx?.chainId || ROBINHOOD_CHAIN_ID,
      };
      const txHashValue = await sha256Hex(canonicalize(txPayload));
      const now = new Date();
      const base = {
        schemaVersion: "recipeint.launch-manifest/0.1",
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
    if (!manifest || !window.ethereum || !account) {
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
      const signed = (await window.ethereum.request({
        method: "eth_signTypedData_v4",
        params: [account, JSON.stringify(typedData)],
      })) as string;
      const signedManifest = { ...manifest, signature: signed };
      setManifest(signedManifest);
      setSignature(signed);
      window.localStorage.setItem("recipeint:manifest", JSON.stringify(signedManifest));
      setNotice("Manifest signed. This was a message signature—not a token approval or transaction.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Manifest signature was rejected.");
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
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      setNotice("Enter a valid 32-byte transaction hash.");
      return;
    }
    setBusy("verify");
    setVerifyRows([]);
    try {
      const [tx, receipt] = await Promise.all([
        rpcCall<Record<string, string> | null>("eth_getTransactionByHash", [txHash]),
        rpcCall<Record<string, string> | null>("eth_getTransactionReceipt", [txHash]),
      ]);
      if (!tx || !receipt) throw new Error("Transaction was not found or is not yet indexed.");

      const rows: VerifyRow[] = [];
      const succeeded = receipt.status === "0x1";
      rows.push({
        label: "Transaction execution",
        actual: succeeded ? "Succeeded" : "Reverted",
        status: succeeded ? "confirmed" : "mismatch",
        detail: succeeded ? "The launch transaction was included successfully." : "No launch state should be trusted.",
      });
      rows.push({
        label: "Creator wallet",
        expected: manifest?.creator,
        actual: tx.from || "Unknown",
        status:
          manifest?.creator && tx.from.toLowerCase() !== manifest.creator.toLowerCase()
            ? "mismatch"
            : manifest?.creator
              ? "confirmed"
              : "unknown",
        detail: "Compared with the wallet that signed the saved manifest.",
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
        detail: "A factory mismatch can redirect an otherwise identical launch.",
      });
      rows.push({
        label: "Transaction calldata",
        expected: manifest?.transaction.data ? `${manifest.transaction.data.slice(0, 18)}…` : undefined,
        actual: tx.input ? `${tx.input.slice(0, 18)}…` : "0x",
        status: manifest?.transaction.data
          ? normalizeHex(tx.input) === normalizeHex(manifest.transaction.data)
            ? "confirmed"
            : "mismatch"
          : "unknown",
        detail: "Exact byte-for-byte comparison with the prepared transaction.",
      });

      const deployedToken = tokenAddress || receipt.contractAddress || "";
      if (isAddress(deployedToken)) {
        const [nameHex, symbolHex, decimalsHex, supplyHex, ownerHex, code, implementationHex, adminHex] =
          await Promise.all([
            readContract(deployedToken, "0x06fdde03"),
            readContract(deployedToken, "0x95d89b41"),
            readContract(deployedToken, "0x313ce567"),
            readContract(deployedToken, "0x18160ddd"),
            readContract(deployedToken, "0x8da5cb5b"),
            rpcCall<string>("eth_getCode", [deployedToken, "latest"]),
            rpcCall<string>("eth_getStorageAt", [deployedToken, EIP1967_IMPLEMENTATION_SLOT, "latest"]),
            rpcCall<string>("eth_getStorageAt", [deployedToken, EIP1967_ADMIN_SLOT, "latest"]),
          ]);
        const name = decodeAbiString(nameHex) || "Unreadable";
        const symbol = decodeAbiString(symbolHex) || "Unreadable";
        const decimals = decimalsHex ? Number.parseInt(decimalsHex, 16) : 18;
        const supply = supplyHex ? formatUnits(BigInt(supplyHex), decimals) : "Unreadable";
        const owner = decodeAddress(ownerHex);
        const implementation = decodeAddress(implementationHex);
        const admin = decodeAddress(adminHex);
        const expectedSupply = manifest?.token.expectedSupply.replace(/^0+/, "") || "";
        const actualSupply = supply.replace(/,/g, "").split(".")[0].replace(/^0+/, "");

        rows.push({
          label: "Token bytecode",
          actual: code && code !== "0x" ? `${(code.length - 2) / 2} bytes deployed` : "No bytecode",
          status: code && code !== "0x" ? "confirmed" : "mismatch",
          detail: `Read directly from ${shortAddress(deployedToken)}.`,
        });
        rows.push({
          label: "Token name",
          expected: manifest?.token.name,
          actual: name,
          status: manifest?.token.name
            ? name === manifest.token.name
              ? "confirmed"
              : "mismatch"
            : "unknown",
          detail: "Read from name().",
        });
        rows.push({
          label: "Token ticker",
          expected: manifest?.token.symbol,
          actual: symbol,
          status: manifest?.token.symbol
            ? symbol === manifest.token.symbol
              ? "confirmed"
              : "mismatch"
            : "unknown",
          detail: "Read from symbol().",
        });
        rows.push({
          label: "Total supply",
          expected: manifest?.token.expectedSupply,
          actual: supply,
          status: manifest?.token.expectedSupply
            ? expectedSupply === actualSupply
              ? "confirmed"
              : "mismatch"
            : "unknown",
          detail: `totalSupply() with ${decimals} decimals.`,
        });
        rows.push({
          label: "Owner",
          actual: owner || "No standard owner()",
          status: owner ? "warning" : "unknown",
          detail: owner
            ? "A live owner may retain privileged control. Inspect its callable functions."
            : "Absence of owner() does not prove absence of admin roles.",
        });
        rows.push({
          label: "EIP-1967 proxy",
          actual: implementation ? `Implementation ${shortAddress(implementation)}` : "No implementation slot",
          status: implementation ? "warning" : "confirmed",
          detail: implementation
            ? "Upgradeable code can change after this check."
            : "Standard EIP-1967 implementation slot is empty.",
        });
        rows.push({
          label: "EIP-1967 admin",
          actual: admin ? shortAddress(admin) : "No standard admin slot",
          status: admin ? "warning" : "confirmed",
          detail: admin ? "This address may control upgrades." : "Standard EIP-1967 admin slot is empty.",
        });
      } else {
        rows.push({
          label: "Token contract",
          actual: "Not provided",
          status: "unknown",
          detail: "Factory launches do not expose contractAddress in the receipt. Paste the token address to inspect it.",
        });
      }

      setVerifyRows(rows);
      setVerifyMeta({
        block: Number.parseInt(receipt.blockNumber || "0x0", 16).toLocaleString("en-US"),
        from: tx.from || "",
        to: tx.to || "",
      });
      setNotice("Launch read from Robinhood Chain. Review every Unknown and Warning manually.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to read the launch transaction.");
    } finally {
      setBusy("");
    }
  }

  const verifyCounts = verifyRows.reduce(
    (totals, row) => ({ ...totals, [row.status]: totals[row.status] + 1 }),
    { confirmed: 0, warning: 0, unknown: 0, mismatch: 0 } as Record<CheckStatus, number>,
  );

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
        <button className="wallet-button" onClick={connectWallet} disabled={busy === "connect"}>
          <span className={account ? "wallet-dot connected" : "wallet-dot"} />
          {account ? shortAddress(account) : busy === "connect" ? "Connecting…" : "Connect wallet"}
        </button>
      </header>

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
          {projectLinkList.map((link) =>
            link.href ? (
              <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
                <span>{link.shortLabel}</span>
                <strong>{projectLinkStatusLabel[link.status]} ↗</strong>
              </a>
            ) : (
              <span key={link.label} className="project-link-disabled" aria-disabled="true">
                <span>{link.shortLabel}</span>
                <strong>{projectLinkStatusLabel[link.status]}</strong>
              </span>
            ),
          )}
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
                <Field label="Token name" value={form.tokenName} onChange={(value) => update("tokenName", value)} />
                <Field label="Ticker" value={form.tokenSymbol} onChange={(value) => update("tokenSymbol", value.toUpperCase())} hint="Use RCPNT if the full ticker is rejected." />
              </div>
              <Field label="Expected total supply" value={form.supply} onChange={(value) => update("supply", value.replace(/[^0-9,]/g, ""))} mono />
              <div className="field-grid two">
                <Field label="Fee beneficiary" value={form.beneficiary} onChange={(value) => update("beneficiary", value)} placeholder="0x…" mono />
                <Field label="Treasury" value={form.treasury} onChange={(value) => update("treasury", value)} placeholder="0x…" mono />
              </div>
              <div className="field-grid two">
                <Field label="Website" value={form.website} onChange={(value) => update("website", value)} placeholder="https://…" />
                <Field label="X profile" value={form.xUrl} onChange={(value) => update("xUrl", value)} placeholder="https://x.com/…" />
              </div>
              <Field label="Launchpad" value={form.launchpad} onChange={(value) => update("launchpad", value)} />

              <label className="field transaction-field">
                <span className="field-label">Prepared transaction JSON <span>optional until pools.trade is live</span></span>
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
                  <div><span className="receipt-kicker">RECIPEINT PREFLIGHT</span><strong>{form.tokenName || "UNTITLED"}</strong><small>${form.tokenSymbol || "—"} · {form.launchpad || "Launchpad not set"}</small></div>
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
                  <div className="manifest-head"><span>Signed launch manifest</span>{signature ? <StatusPill status="confirmed" /> : <span className="unsigned">Unsigned</span>}</div>
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
              <p>Read the launch directly from Robinhood Chain and compare it with the signed manifest saved on this device.</p>
              <Field label="Launch transaction hash" value={txHash} onChange={setTxHash} placeholder="0x…" mono />
              <Field label="Token contract" value={tokenAddress} onChange={setTokenAddress} placeholder="0x… (required for factory launches)" mono hint="Most launchpad receipts do not expose contractAddress directly." />
              <button className="primary-action verify-action" onClick={verifyLaunch} disabled={busy === "verify"}>
                <span>{busy === "verify" ? "Reading Robinhood Chain…" : "Verify launch"}</span><span>→</span>
              </button>
              <div className="saved-manifest-card">
                <span>Local comparison manifest</span>
                {manifest ? <><strong>{manifest.token.name} · ${manifest.token.symbol}</strong><small>{signature ? "Signed" : "Unsigned"} · {manifest.manifestHash.slice(0, 14)}…</small></> : <><strong>No manifest saved</strong><small>Transaction inspection will still work, but intended values remain Unknown.</small></>}
              </div>
            </div>

            <div className="verify-result-panel">
              {verifyRows.length ? (
                <>
                  <div className="verify-result-head">
                    <div><span className="receipt-kicker">ONCHAIN RESULT</span><h3>{verifyCounts.mismatch ? "Launch mismatch" : verifyCounts.warning ? "Warnings found" : "Parameters match"}</h3><p>Block {verifyMeta.block} · {shortAddress(verifyMeta.from)} → {shortAddress(verifyMeta.to)}</p></div>
                    <StatusPill status={verifyCounts.mismatch ? "mismatch" : verifyCounts.warning ? "warning" : "confirmed"} />
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
                  <h3>No transaction loaded</h3>
                  <p>Paste a Robinhood Chain launch transaction to inspect execution, token identity, supply, owner and standard proxy slots.</p>
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
