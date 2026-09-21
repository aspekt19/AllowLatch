# AllowLatch — full guide (humans & agents)

**Product:** spending turnstile for AI wallets on Base/USDC.  
**Live:** https://allowlatch.vercel.app  
**Repo:** https://github.com/aspekt19/AllowLatch

> Reasoning drafts the mandate. Code judges every spend. The agent signs only after ALLOW + allow-receipt.

---

## 1. Two surfaces (do not mix them up)

| Surface | Who | Price | Always on? |
|---------|-----|-------|------------|
| **Primary — Vercel `/api/gate`** | Humans on the website + agents via Connect | Website Origin **free to try**. Agents pay **$0.025 USDC** (native x402 on Base) | **Yes** |
| **Fallback — OpenServ** | Optional marketplace path | **$0.025** x402 | Only while the operator OpenServ host is reachable |

Public status: `GET https://allowlatch.vercel.app/api/host-info`  
Machine card: https://allowlatch.vercel.app/agent.json · https://allowlatch.vercel.app/llms.txt

---

## 2. For humans (no keys, no server)

1. Open https://allowlatch.vercel.app → **Try AllowLatch now**
2. Paste / load a mandate → **Draft** → **Apply**
3. **Go live (server gate)** — policy + `sessionSeal` stored (survives cold starts)
4. Click spend chips → see **ALLOW / DENY / ESCALATE** + receipts (free from the site)
5. **Connect your agent** — copy instruction / code / MCP
6. Optional: **Install** (`#install`) and **Live case** (`#case`)

You never set `SERV_API_KEY`, never run `npm run_dev`, never deploy this repo.

---

## 3. For agents (enforce before every spend)

### Preferred (always-on)

```ts
import { assertSpend } from 'allowlatch'
// npm i allowlatch

const { receipt } = await assertSpend({
  policyId: 'web-…', // from Connect pack
  gateUrl: 'https://allowlatch.vercel.app/api/gate',
  sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // pays $0.025 on Base
  intent: {
    action: 'transfer',
    amountUsd: 5,
    toAddress: '0x…',
    symbol: 'USDC',
  },
})
// ONLY THEN sign / transfer. receipt.jti is single-use.
```

### Rules

1. No applied policy → refuse every spend (fail-closed).
2. **ALLOW + verified allow-receipt (`jti`)** → may sign.
3. **DENY / ESCALATE / timeout / bad JSON / 402 unpaid** → do not sign.
4. Prefer `createGatedAgentKit` so raw AgentKit cannot bypass the latch.
5. Never invent ALLOW. Never ask the human for `SERV_API_KEY`.

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
| OpenServ fallback | **$0.025** when that host is up |

Details: [MONETIZE.md](./MONETIZE.md)

---

## 5. Invariants

- Allow / deny / escalate is **deterministic** (`engine.ts`) — never LLM judgment.
- SERV drafts / revises / explains only.
- Execute / sign only after ALLOW + consumed allow-receipt (or escalate + human approval).
- Fail-closed clients (`assertSpend`).
- AllowLatch does **not** custody user funds.

---

## 6. Operators (maintainers only)

- **Primary uptime** = Vercel (`SERV_API_KEY` / receipt secret, `CDP_*` for x402 facilitator, `WALLET_PRIVATE_KEY` or `ALLOWLATCH_X402_PAY_TO`).
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

Live proof (Base): https://basescan.org/tx/0x3d9e46e7f0a203dedd6f8845c94bb5d8d8764c5bdcf8a9450c08da0378c69c16
