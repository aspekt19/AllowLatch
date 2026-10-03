# Architecture notes

AllowLatch is a **payment policy turnstile** for financial AI agents on Base (USDC): NL → SERV draft → deterministic gate → allow-receipt → optional execute (AgentKit/CDP or caller-signed), with optional **on-chain Spend Permission** mirroring.

## Surfaces (do not confuse)

| Surface | What it is |
|---------|------------|
| **https://allowlatch.vercel.app** | Product UI + **always-on** `/api/gate` (native Base USDC x402 for agents) + `/api/copilot` + `/api/host-info`. |
| **AllowLatch Gate (OpenServ)** | **Optional fallback:** discover `/allowlatch/i`, pay $0.025 when the operator host is reachable. **End users never run this.** |
| **`npm run dev` / `deploy:openserv`** | Operator-only: keep the hosted gate process online. See [HOSTED.md](./HOSTED.md). |
| **HTTP gate** (`npm run http:gate`) | Local/dev framework-agnostic API on loopback — optional for builders testing embeds. |

## Execution path

```text
evaluate_intent
   → ALLOW + action-bound allow-receipt
      (jti, policyHash, chain, action digest, calldataHash for swaps, HMAC)
   → ESCALATE → humanApproved + ownerToken → re-evaluate mints receipt
   → createGatedAgentKit / execute_gated_transfer
   → verify + consume jti (site kit consumes before returning receipt)
   → [wallet_native/hybrid] use_spend_permission (pull USDC under on-chain cap)
   → AgentKit transfer (or dry-run)
```

Unused authorized receipts past `expiresAt` release reserved daily/lifetime budget on the next evaluate.

**Fail-closed:** timeouts, payment failures, malformed decisions, missing/invalid receipts, and **host unavailability** are DENY on the client (`assertSpend`) — never fail-open. See [SECURITY.md](./SECURITY.md).

**Swaps:** host evaluates + issues receipt; it does **not** submit swap txs. Swap intents **require** `calldataHash` (and preferably `contractAddress`). Caller must re-supply the same hash when verifying before an external router/AgentKit swap. The agent must refuse to sign without verify — put that check in the wallet adapter, not in prompt text alone.

**Chain / token:** intent `chainId` / `networkId` must match `policy.chain` when set; prefer `allowedTokenAddresses` over symbols; USDC + `tokenAddress` must be the canonical Base USDC contract.

## Enforcement modes

See [WALLET_NATIVE.md](./WALLET_NATIVE.md). Short version:

- `hybrid` - **default** — receipt + CDP Spend Permission daily USDC cap when funded SA → AgentKit wallet is synced (primary: agent `hybrid_plan`; operator: `sync_wallet` / host env)
- `middleware` - receipt only (not custody-grade if the signer can bypass the gate)
- `wallet_native` - live execute blocked until permission is `synced`

**Invariant:** if the agent holds the private key to the funded account, on-chain Spend Permissions do not stop a raw `transfer`. Keep USDC on the owner Smart Account; AgentKit wallet only. Site UX is AgentKit turnstile — not consumer wallet connect.

## Storage

| Surface | Backend |
|---------|---------|
| **Primary** always-on `/api/gate` | **Turso** when `ALLOWLATCH_TURSO_*` is set (`durable: true` on `GET /api/gate`); otherwise in-memory + `sessionSeal` (demo) |
| OpenServ / local HTTP host | **SQLite** (`data/allowlatch.sqlite`, `ALLOWLATCH_SQLITE_PATH`) — WAL, `BEGIN IMMEDIATE`, exclusive queue |

Abstraction: `PolicyStoreApi` (`src/store/types.ts`) + `createStore()` / Turso site store. Clients must fail-closed when the ledger is unreachable.

## Adapters

| Adapter | Entry |
|---------|--------|
| **Primary** Vercel `/api/gate` | https://allowlatch.vercel.app/api/gate · [CONNECT.md](./CONNECT.md) |
| OpenServ fallback | Discover **AllowLatch Gate** · [HOSTED.md](./HOSTED.md) |
| Operator process | `npm run deploy:openserv` or `npm run dev` (optional keep-alive) |
| HTTP gate (dev) | `npm run http:gate` |
| npm SDK | `import { assertSpend, createGatedAgentKit, allowLatchActionProvider, recommendProductionShape } from 'allowlatch'` |
| AgentKit action provider | `allowLatchActionProvider()` · `src/sdk/allowlatch-action-provider.ts` |
| MCP | `npm run mcp` / `npx allowlatch-mcp` |

## Demo Copilot hardening

`/api/copilot` allows only configured Origins (AllowLatch + localhost), rate-limits by IP, and caps body/mandate size. It never executes spends.

Demo: https://allowlatch.vercel.app
