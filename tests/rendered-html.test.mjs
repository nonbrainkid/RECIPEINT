import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(html, /not a smart contract audit/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});

test("keeps wallet actions limited to disclosure and verification", async () => {
  const [page, layout, links, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/project-links.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /eth_signTypedData_v4/);
  assert.match(page, /eth_getTransactionByHash/);
  assert.match(page, /eth_getStorageAt/);
  assert.match(page, /recipeint\.launch-manifest\/0\.1/);
  assert.doesNotMatch(page, /eth_sendTransaction|wallet_sendCalls|permit\(/);
  assert.match(page, /No rewards are funded/);
  assert.match(page, /<button className="claim-button" type="button" disabled>/);
  assert.match(page, /may vary or be zero/);
  assert.match(links, /0x6245e67affa44a23077f0ea7f981a8dc743a0c47/);
  assert.match(links, /href: null,[\s\S]*status: "after-launch"/);
  assert.doesNotMatch(links, /x\.com\/|t\.me\//);
  assert.match(layout, /Signed Launch Preflight/);
  assert.match(packageJson, /"build": "next build"/);
  assert.doesNotMatch(packageJson, /vinext|cloudflare|vite/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
