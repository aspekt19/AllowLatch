# Architecture notes

AllowLatch is a **payment policy turnstile** for financial AI agents on Base (USDC): NL → SERV draft → deterministic gate → allow-receipt → optional execute (AgentKit/CDP or caller-signed), with optional **on-chain Spend Permission** mirroring.

## Execution path

```text
evaluate_intent
   → ALLOW + action-bound allow-receipt
      (jti, policyHash, action digest, optional calldataHash, HMAC)
   → execute_gated_transfer(receipt)
   → verify + consume jti
   → [wallet_native/hybrid] use_spend_permission (pull USDC under on-chain cap)
   → AgentKit transfer (or dry-run)
```

## Enforcement modes

See [WALLET_NATIVE.md](./WALLET_NATIVE.md). Short version:

- `middleware` - receipt only  
- `hybrid` - receipt + CDP Spend Permission daily USDC cap (recommended)  
- `wallet_native` - live execute blocked until permission is `synced`

## Storage

SQLite (`data/allowlatch.sqlite`): WAL, `BEGIN IMMEDIATE`, exclusive queue, audit, packs, wallet_bindings. Single-writer host process (scale-out → one primary writer or external DB later).

## Adapters

| Adapter | Entry |
|---------|--------|
| OpenServ host | `npm run dev` (x402 service name: **AllowLatch Gate**, $0.025) |
| HTTP gate | `npm run http:gate` |
| SDK | `src/sdk/assert-spend.ts` · `createGatedAgentKit` |

Demo: https://allowlatch.vercel.app
