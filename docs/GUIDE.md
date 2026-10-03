# AllowLatch — full guide (humans & agents)

**Product:** spending turnstile for AI wallets on Base/USDC.  
**Live:** https://allowlatch.vercel.app  
**Repo:** https://github.com/aspekt19/AllowLatch

> Reasoning drafts the mandate. Code judges every spend. The agent signs only after ALLOW + allow-receipt.

---

## 1. Surfaces (one primary path)

**Use the site gate.** OpenServ is optional fallback only — ignore it unless `/api/gate` is down.

| Surface | Who | Price | Always on? |
|---------|-----|-------|------------|
| **Primary — Vercel `/api/gate`** | Humans on the website + agents via Connect | Website **browser** free to try (same-site fetch). Agents pay **$0.025 USDC** (native x402 on Base) | **Yes** — set `ALLOWLATCH_TURSO_*` for durable multi-instance ledger; otherwise memory+seal demo |
| **Fallback — OpenServ** | Optional marketplace path | **$0.025** x402 | Only while the operator OpenServ host is reachable |

Public status: `GET https://allowlatch.vercel.app/api/host-info`  
Machine card: https://allowlatch.vercel.app/agent.json · https://allowlatch.vercel.app/llms.txt

---

## 2. For humans (no keys, no server)

1. Open https://allowlatch.vercel.app → **Try AllowLatch now**
2. **Simple rules** or paste a mandate → **Draft** (SERV Reasoning) → **Apply**
3. **Go live (server gate)** — policy + `sessionSeal` (survives cold starts; production also persists ledger on Turso when configured)
4. **On-chain ceiling (recommended):** Path A — owner SA + agent spender → Sync (`sync_wallet`); or Path B — leave it for the agent via **Copy for my AI** (`hybrid_plan`)
5. Click spend chips → see **ALLOW / DENY / ESCALATE** + receipts (free from the site)
6. **Connect your agent** — **Copy for my AI** only after Go live + `sessionSeal`
7. Optional: **Install** (`#install`) and **Live case** (`#case`) — full SERV + paid Base path

You never set `SERV_API_KEY`, never run the local OpenServ host, never deploy this repo.
Agents that call `/api/gate` need a **Base USDC payer key** for x402 ($0.025) — that is not a host SERV/CDP key, and it is not custody by AllowLatch.

**Required agent path:** `createGatedAgentKit({ gate: { kind: 'site', … } })` (+ hybrid Spend Permissions). `assertSpend` alone is **advisory** if a raw signer still exists.

**Hard rule:** do **not** give the agent the private key to the funded account. Keep USDC on the owner Smart Account; the agent is spender-only. Details: [WALLET_NATIVE.md](./WALLET_NATIVE.md) · [CONNECT.md](./CONNECT.md).

**Site-gate honesty:** Production (`GET /api/gate` → `durable: true`) uses Turso for shared ledger + receipts. Without Turso, `sessionSeal` restores policy after cold starts but is not multi-tenant durable. Keep live balances small unless durable + hybrid on-chain caps. Details: [SECURITY.md](./SECURITY.md).

---

## 3. For agents (enforce before every spend)

### Required (always-on site gate)

```ts
import { createGatedAgentKit } from 'allowlatch'
// npm i allowlatch@^0.2.3

const agent = await createGatedAgentKit({
  policyId: '…',
  gate: {
    kind: 'site',
    gateUrl: 'https://allowlatch.vercel.app/api/gate',
    sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // x402 payer only
  },
})
await agent.transfer({ toAddress: '0x…', amountUsd: 0.04, reason: 'gated spend' })
// evaluate → receipt → sign; no parallel raw signer
```

`assertSpend` alone is **advisory** (checks the gate but does not remove a raw signer). Prefer the gated kit above.

**Hybrid ceiling:** `POST action=hybrid_plan` → CDP `createSpendPermission` (owner SA → your spender) → optional `hybrid_report`. Or the owner runs Path A `sync_wallet` on the site. Never hold the treasury private key.

### Local HTTP host / OpenServ (dev or fallback)

```ts
import { createGatedAgentKit } from 'allowlatch'

const agent = await createGatedAgentKit({
  policyId: '…',
  gate: { kind: 'http', baseUrl: 'http://127.0.0.1:8787' }, // or kind: 'openserv'
})
await agent.transfer({ toAddress: '0x…', amountUsd: 0.04 })
```

### Rules

1. No applied policy → refuse every spend (fail-closed).
2. **ALLOW + verified allow-receipt (`jti`)** → may sign.
3. **DENY / ESCALATE / timeout / bad JSON / 402 unpaid** → do not sign.
4. Prefer `createGatedAgentKit` so the supported spend path hits AllowLatch before signing (not custody if a raw key remains).
5. Never invent ALLOW. Never ask the human for `SERV_API_KEY`.
6. Never accept the funded/treasury private key — USDC on owner Smart Account; you = spender only.

### Optional OpenServ fallback

If the site gate is unreachable and `triggerUrl` is set, `assertSpend` can fall back to OpenServ x402.  
Do **not** treat `gate.isActive: true` alone as healthy — timeout still means DENY.

### Other install paths

| Path | Entry |
|------|--------|
| Connect pack | https://allowlatch.vercel.app → Go live → Connect |
| npm | `npm i allowlatch` |
| MCP | `npx allowlatch-mcp` |
| Skill (any LLM) | [`skills/allowlatch/SKILL.md`](../skills/allowlatch/SKILL.md) |
| llms.txt | https://allowlatch.vercel.app/llms.txt |

---

## 4. Pricing

| Call | Price |
|------|-------|
| Website UI (AllowLatch Origin) | Free |
| Agent → `/api/gate` | **$0.025 USDC** on Base → operator `payTo` from host-info |
| Agent → `buy_pack` + `packKey` | **$0.025** → default **3** credits (~$0.008/check; Turso durable required) |
| OpenServ fallback | **$0.025** when that host is up (`buy_evaluate_pack` = same pack idea) |

Details: [MONETIZE.md](./MONETIZE.md). Production checklist: site [#ready](https://allowlatch.vercel.app/#ready) · `recommendProductionShape()`.

---

## 5. Invariants

- Allow / deny / escalate is **deterministic** (`engine.ts`) — never LLM judgment.
- SERV drafts / revises / explains only.
- Execute / sign only after ALLOW + consumed allow-receipt (or escalate + human approval).
- Fail-closed clients (`createGatedAgentKit` / `assertSpend`).
- AllowLatch does **not** custody user funds.

---

## 6. Operators (maintainers only)

- **Primary uptime** = Vercel (`ALLOWLATCH_RECEIPT_SECRET` required in prod, `SERV_API_KEY` for Copilot only, `CDP_*` for x402 facilitator, `WALLET_PRIVATE_KEY` or `ALLOWLATCH_X402_PAY_TO`, prefer `ALLOWLATCH_TURSO_*`).
- **OpenServ** = optional: [HOSTED.md](./HOSTED.md) · `npm run deploy:host`.
- Local tunnel `npm run dev` = incident/debug only.

---

## 7. Doc map

| Doc | Audience |
|-----|----------|
| **This guide** | Everyone — start here |
| [CONNECT.md](./CONNECT.md) | Short connect cheat-sheet |
| [EMBED.md](./EMBED.md) | Builders embedding the SDK |
| [MONETIZE.md](./MONETIZE.md) | Pricing |
| [HOSTED.md](./HOSTED.md) | OpenServ fallback ops |
| [SECURITY.md](./SECURITY.md) | Threat model |
| [PRODUCT.md](./PRODUCT.md) | Product definition |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System layout |
| [AGENTS.md](../AGENTS.md) | Coding agents in-repo |

Live proof (SERV + paid site gate · Base): https://basescan.org/tx/0x399dd953a96332dfbb0e27dfc19dea0898c0a1a236f065216ef4e6759a2792b5  
Story: https://allowlatch.vercel.app/#case
