# RECIPEINT

Creator-side signed launch preflight for Robinhood Chain.

The MVP records a launch intent, hashes the prepared transaction, requests an
EIP-712 message signature, and compares the resulting transaction and deployed
token fields with the saved manifest. It never submits a launch transaction,
requests a token approval, or labels a token as safe.

The interface also previews the declared 50/50 fee policy and a future FRONG
Merkle-claim surface. The claim is intentionally disabled until rewards are
funded and a snapshot block plus Merkle root are published. Token, X and
Telegram links live in `app/project-links.ts`; unset links render as non-clickable
launch states instead of placeholders.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validate

```bash
npm test
npm run lint
```

Robinhood Chain mainnet is configured as chain ID `4663`. The public RPC is
used for read-only verification, with the connected wallet as a fallback.

## Current limits

- The pools.trade factory and calldata schema must be confirmed after launch.
- A standard `owner()` and EIP-1967 slots are inspected, but this is not a full
  privilege or mint-path analysis.
- Manifests are stored on the current device and downloaded as JSON; there is
  no public registry in v0.1.
- RECIPEINT is independent and is not affiliated with Uniswap Labs,
  pools.trade, Robinhood, or Vitalik Buterin.
