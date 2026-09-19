# Architecture notes

AllowLatch is a **payment policy turnstile** for financial AI agents on Base (USDC): NL → SERV draft → deterministic gate → allow-receipt → optional execute (AgentKit/CDP or caller-signed), with optional **on-chain Spend Permission** mirroring.

## Surfaces (do not confuse)

| Surface | What it is |
|---------|------------|
| **https://allowlatch.vercel.app** | Demo UI + `/api/copilot` (SERV draft/revise/explain) + `/api/host-info` (public paywall/trigger). **Not** the x402 gate process itself. |
| **AllowLatch Gate (OpenServ, hosted)** | Production path for everyone: discover `/allowlatch/i`, pay $0.025 / pack, evaluate, receipt, optional execute. **End users never run this.** |
| **`npm run dev` / `deploy:openserv`** | Operator-only: keep the hosted gate process online. See [HOSTED.md](./HOSTED.md). |
| **HTTP gate** (`npm run http:gate`) | Local/dev framework-agnostic API on loopback — optional for builders testing embeds. |

## Execution path

```text
evaluate_intent
   → ALLOW + action-bound allow-receipt
      (jti, policyHash, chain, action digest, calldataHash for swaps, HMAC)
   → execute_gated_transfer(receipt)
   → verify + consume jti
   → [wallet_native/hybrid] use_spend_permission (pull USDC under on-chain cap)
   → AgentKit transfer (or dry-run)
```

**Fail-closed:** timeouts, payment failures, malformed decisions, and missing/invalid receipts are DENY — see [SECURITY.md](./SECURITY.md).

**Swaps:** host evaluates + issues receipt; it does **not** submit swap txs. Swap intents **require** `calldataHash` (and preferably `contractAddress`). Caller must re-supply the same hash when verifying before an external router/AgentKit swap.

**Chain / token:** intent `chainId` / `networkId` must match `policy.chain` when set; prefer `allowedTokenAddresses` over symbols; USDC + `tokenAddress` must be the canonical Base USDC contract.

## Enforcement modes

See [WALLET_NATIVE.md](./WALLET_NATIVE.md). Short version:

- `middleware` - receipt only (not custody-grade if the signer can bypass the gate)
- `hybrid` - receipt + CDP Spend Permission daily USDC cap (recommended)
- `wallet_native` - live execute blocked until permission is `synced`

## Storage

SQLite (`data/allowlatch.sqlite`, override with `ALLOWLATCH_SQLITE_PATH`): WAL, `BEGIN IMMEDIATE`, exclusive queue, audit, packs, wallet_bindings. Single-writer host process.

## Adapters

| Adapter | Entry |
|---------|--------|
| Hosted OpenServ gate | Discover **AllowLatch Gate** · [CONNECT.md](./CONNECT.md) · [HOSTED.md](./HOSTED.md) |
| Operator process | `npm run deploy:openserv` or `npm run dev` |
| HTTP gate (dev) | `npm run http:gate` |
| SDK | `src/sdk/assert-spend.ts` · `createGatedAgentKit` |

## Demo Copilot hardening

`/api/copilot` allows only configured Origins (AllowLatch + localhost), rate-limits by IP, and caps body/mandate size. It never executes spends.

Demo: https://allowlatch.vercel.app
