# Architecture notes

AllowLatch is an **application-layer payment policy turnstile**, not a custody vault. Brand is **AllowLatch** only.

## Enforced execution path

```text
evaluate_intent
   → ALLOW + action-bound allow-receipt
      (jti, policyHash, action digest, optional calldataHash, HMAC)
   → execute_gated_transfer(receipt)
   → verify receipt (policy + action + calldata)
   → consume jti (single-use / anti-replay)
   → AgentKit transfer (or dry-run)
```

- Host executor **requires** a valid receipt (or `humanApproved` on escalate → mint+consume).
- Action digest ignores free-text `reason` — binds amount / destination / selector / calldata.
- Idempotency keys (`requestId`) prevent double-spend on retries.
- Swaps: evaluate + receipt for **external** routers; host does not submit swaps in v1.

## Storage

- SQLite (`data/allowlatch.sqlite`): WAL, `BEGIN IMMEDIATE`, process-local exclusive queue.
- Atomic ledger + receipt consume + audit + evaluate-pack credits.
- Legacy JSON files migrate once on boot.

## Policy surface

- Lifetime hard ledger cap, daily / per-tx / hourly velocity
- Symbols, addresses, contracts, function selectors
- Slippage / gas / emergency stop
- `ownerId` / `agentId`

## Pricing adapters

| Path | Meter |
|------|--------|
| OpenServ x402 | $0.10 / call (default) |
| Evaluate pack | $1 → 25 credits (`buy_evaluate_pack` / `POST /v1/packs/purchase`) |
| HTTP gate | `npm run http:gate` — same engine, optional Bearer token |

## Honest limits

Cooperative middleware: a spender that never calls AllowLatch and signs with raw keys bypasses the gate. Pair with wallet-native Spend Permissions for custody-grade caps — [WALLET_NATIVE.md](./WALLET_NATIVE.md).

Demo URL: **https://allowlatch.vercel.app** only.
