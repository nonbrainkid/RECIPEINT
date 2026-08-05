import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateEvidenceStatus,
  classifyTokenProvenance,
  compareExactSupply,
  canonicalize,
  detectEip1167Implementation,
  evaluateManifestIntegrity,
  parsePreparedTransaction,
  sha256Hex,
} from "../app/verifier-helpers.ts";
import {
  legacyWalletName,
  mergeWalletOptions,
  safeWalletIcon,
  toEip6963Wallet,
} from "../app/wallet-providers.ts";

const root = new URL("../", import.meta.url);

async function render() {
  return readFile(new URL(".next/server/app/index.html", root), "utf8");
}

test("prerenders the RECIPEINT launch preflight", async () => {
  const html = await render();
  assert.match(html, /RECIPEINT/);
  assert.match(html, /Catch the mismatch before the signature/i);
  assert.match(html, /Generate launch manifest/i);
  assert.match(html, /Verify launch/i);
  assert.match(html, /NO TOKEN PROVIDED/i);
  assert.match(html, /Ticker not provided/i);
  assert.match(html, /Launchpad not provided/i);
  assert.match(html, /Half to FRONG/i);
  assert.match(html, /No rewards are funded/i);
  assert.match(html, /Claim after launch/i);
  assert.match(html, /Toggle color theme/i);
  assert.match(html, /Token contract available after launch/i);
  assert.match(html, /CA: After launch/i);
  assert.match(html, />COPY</i);
  assert.match(html, /not a smart contract audit/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});

test("keeps wallet actions limited to disclosure and verification", async () => {
  const [page, layout, links, packageJson, remotionRoot, nextConfig, verifierHelpers] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/project-links.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("remotion/root.tsx", root), "utf8"),
    readFile(new URL("next.config.ts", root), "utf8"),
    readFile(new URL("app/verifier-helpers.ts", root), "utf8"),
  ]);
  const packageData = JSON.parse(packageJson);

  assert.match(page, /eth_signTypedData_v4/);
  assert.match(page, /eip6963:announceProvider/);
  assert.match(page, /eip6963:requestProvider/);
  assert.match(page, /selectedProviderRef\.current/);
  assert.match(page, /No injected EVM wallets detected/);
  assert.match(page, /https:\/\/metamask\.io\/download\//);
  assert.match(page, /Wallet names are reported by browser extensions/);
  assert.doesNotMatch(page, /role="listitem"/);
  assert.equal(page.match(/eth_requestAccounts/g)?.length, 1);
  const connectWalletBody = page.slice(
    page.indexOf("function connectWallet()"),
    page.indexOf("async function selectWallet"),
  );
  assert.doesNotMatch(connectWalletBody, /eth_requestAccounts/);
  assert.match(page, /wallet\.provider\.request\(\{ method: "eth_requestAccounts" \}\)/);
  assert.doesNotMatch(page, /localStorage\.(?:setItem|getItem)\([^\n]*(?:provider|selectedWallet)/i);
  assert.match(page, /eth_getTransactionByHash/);
  assert.match(page, /eth_getStorageAt/);
  assert.match(page, /0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103/);
  assert.match(page, /0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50/);
  assert.match(verifierHelpers, /recipeint\.launch-manifest\/0\.1/);
  assert.match(page, /tokenName: ""/);
  assert.match(page, /tokenSymbol: ""/);
  assert.match(page, /supply: ""/);
  assert.match(page, /launchpad: ""/);
  assert.doesNotMatch(page, /tokenName: "RECIPEINT"|tokenSymbol: "RCPNT"|launchpad: "pools\.trade"/);
  assert.doesNotMatch(page, /eth_sendTransaction|wallet_sendCalls|permit\(/);
  assert.match(page, /No rewards are funded/);
  assert.match(page, /<button className="claim-button" type="button" disabled>/);
  assert.match(page, /may vary or be zero/);
  assert.match(page, /navigator\.clipboard\.writeText\(TOKEN_CONTRACT\)/);
  assert.match(links, /0x6245e67affa44a23077f0ea7f981a8dc743a0c47/);
  assert.match(links, /TOKEN_CONTRACT: string \| null = null/);
  assert.match(links, /X_URL: string \| null = null/);
  assert.match(links, /TELEGRAM_URL: string \| null = null/);
  assert.doesNotMatch(links, /x\.com\/|t\.me\//);
  assert.match(layout, /Signed Launch Preflight/);
  assert.match(layout, /\/brand\/recipeint-avatar\.png/);
  assert.match(layout, /prefers-color-scheme: light/);
  assert.match(packageJson, /"build": "next build"/);
  assert.doesNotMatch(packageJson, /vinext|cloudflare|vite/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.equal(packageData.devDependencies.remotion, "4.0.506");
  assert.equal(packageData.devDependencies["@remotion/cli"], "4.0.506");
  assert.match(remotionRoot, /width=\{1000\} height=\{1000\}/);
  assert.match(remotionRoot, /width=\{1500\} height=\{500\}/);
  assert.match(nextConfig, /X-Content-Type-Options/);
  assert.match(nextConfig, /X-Frame-Options/);
  assert.match(nextConfig, /Referrer-Policy/);
  assert.match(nextConfig, /Permissions-Policy/);
  assert.match(nextConfig, /Cross-Origin-Opener-Policy/);
  assert.doesNotMatch(nextConfig, /Content-Security-Policy/);
});

test("keeps aggregate verification incomplete when evidence is unknown", () => {
  assert.deepEqual(aggregateEvidenceStatus([{ status: "confirmed" }, { status: "unknown" }]), {
    status: "unknown",
    label: "Incomplete evidence",
  });
  assert.deepEqual(
    aggregateEvidenceStatus([{ status: "unknown" }, { status: "warning" }]),
    { status: "warning", label: "Warnings + incomplete evidence" },
  );
  assert.deepEqual(aggregateEvidenceStatus([{ status: "warning" }]), {
    status: "warning",
    label: "Warnings found",
  });
});

test("detects a standard EIP-1167 minimal proxy fixture", () => {
  const fixture =
    "0x363d3d373d3d3d363d7388882688a067fe97e11c2185b996286e531322225af43d82803e903d91602b57fd5bf3";
  assert.equal(
    detectEip1167Implementation(fixture),
    "0x88882688a067fe97e11c2185b996286e53132222",
  );
});

test("compares total supply as an exact uint256", () => {
  const expectedRaw = 1_000_000_000n * 10n ** 18n;
  const supplyHex = `0x${expectedRaw.toString(16).padStart(64, "0")}`;
  assert.equal(compareExactSupply("1000000000", supplyHex, 18).status, "confirmed");
  assert.equal(compareExactSupply("999999999", supplyHex, 18).status, "mismatch");
  assert.equal(compareExactSupply("1000000000", supplyHex, null).status, "unknown");
});

test("does not invent a missing prepared transaction chainId", () => {
  const parsed = parsePreparedTransaction(
    JSON.stringify({ to: "0x1111111111111111111111111111111111111111", data: "0x" }),
  );
  assert.ok(parsed && !("error" in parsed));
  assert.equal(parsed.chainId, null);
  assert.equal(parsed.chainIdProvided, false);
});

test("classifies direct-deploy token provenance independently", () => {
  const receiptAddress = "0x1111111111111111111111111111111111111111";
  assert.equal(
    classifyTokenProvenance({
      hasTransaction: true,
      receiptContractAddress: receiptAddress,
      providedTokenAddress: receiptAddress.toUpperCase().replace("0X", "0x"),
    }).status,
    "confirmed",
  );
  assert.equal(
    classifyTokenProvenance({
      hasTransaction: true,
      receiptContractAddress: receiptAddress,
      providedTokenAddress: "0x2222222222222222222222222222222222222222",
    }).status,
    "mismatch",
  );
});

test("marks tampered and expired manifests as mismatches without claiming signature recovery", async () => {
  const base = {
    schemaVersion: "recipeint.launch-manifest/0.1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    token: { name: "Test" },
  };
  const manifestHash = await sha256Hex(canonicalize(base));
  assert.equal(
    (await evaluateManifestIntegrity({ ...base, manifestHash, signature: "0xdead" }, 0)).status,
    "unknown",
  );
  assert.equal(
    (await evaluateManifestIntegrity({ ...base, token: { name: "Tampered" }, manifestHash }, 0)).status,
    "mismatch",
  );
  const expired = { ...base, expiresAt: "2020-01-01T00:00:00.000Z" };
  const expiredHash = await sha256Hex(canonicalize(expired));
  assert.equal(
    (await evaluateManifestIntegrity({ ...expired, manifestHash: expiredHash }, Date.now())).status,
    "mismatch",
  );
});

test("dedupes injected wallets and prefers EIP-6963 over legacy aliases", () => {
  const provider = { request: async () => null, isMetaMask: true };
  const announced = toEip6963Wallet({
    info: {
      uuid: "metamask-test",
      name: "MetaMask",
      rdns: "io.metamask",
      icon: "data:image/png;base64,AA==",
    },
    provider,
  });
  assert.ok(announced);
  const merged = mergeWalletOptions([announced, announced], [provider, provider]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "eip6963");
});

test("names Phantom before MetaMask compatibility flags and sanitizes wallet icons", () => {
  const compatibilityProvider = {
    request: async () => null,
    isMetaMask: true,
    isPhantom: true,
  };
  assert.equal(legacyWalletName(compatibilityProvider), "Phantom");
  assert.match(safeWalletIcon("data:image/svg+xml;base64,PHN2Zy8+") || "", /^data:image/);
  assert.equal(safeWalletIcon("https://example.com/icon.png"), null);
  assert.equal(safeWalletIcon("data:text/html,<script>alert(1)</script>"), null);
});
