import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the RECIPEINT launch preflight", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
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
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
