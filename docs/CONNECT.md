# Connect to AllowLatch (for humans & their agents)

Full guide: [GUIDE.md](./GUIDE.md).

You do **not** run a server. You do **not** need `SERV_API_KEY`.

## Two surfaces

| Surface | What it is | Always on? |
|---------|------------|------------|
| **Primary** https://allowlatch.vercel.app/api/gate | Go live + Connect. Browser same-site **free to try**. Agents pay **$0.025 USDC** x402 (or `buy_pack` → prepaid credits). Turso durable when configured (`GET /api/gate` → `durable: true`). | **Yes** (Vercel) |
| **OpenServ fallback** | discover `/allowlatch/i` · trigger/paywall | Only while operator host is reachable |

Install: https://allowlatch.vercel.app/#install  
Skill (any LLM): [`skills/allowlatch/SKILL.md`](../skills/allowlatch/SKILL.md)

## Try on the website

1. Open https://allowlatch.vercel.app → **Load demo mandate (SERV-safe)** (or paste your own) → Draft → Apply → **Go live**
2. Try ALLOW / DENY / ESCALATE (free from the site browser)
3. **Connect your agent** → copy gated-kit instruction (`gateUrl` + `sessionSeal`; **never** `ownerToken`)

Demo mandate wording (passes SERV GUARD in live tests):

> Budget $2 USDC on Base. Max $0.10 per transfer and $0.50 per day. Only allow transfers to 0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205. No swaps. Escalate above $0.05.

## Agent path (required)

```ts
import { createGatedAgentKit } from 'allowlatch'
// npm i allowlatch@^0.2.0

const agent = await createGatedAgentKit({
  policyId: 'web-…',
  gate: {
    kind: 'site',
    gateUrl: 'https://allowlatch.vercel.app/api/gate',
    sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // x402 payer only — not a host key
  },
})

await agent.transfer({
  toAddress: '0x…',
  amountUsd: 0.04,
  reason: 'gated spend',
})
```

**`assertSpend` alone is advisory** — it checks the gate, but does **not** remove a raw AgentKit/CDP signer. Prefer `createGatedAgentKit` so the agent cannot bypass the latch. Hybrid Spend Permissions when configured.

Public card: `GET https://allowlatch.vercel.app/api/host-info` → prefer `primary` (durable site gate); `openserv.isActive` is fallback-only.

Live case (SERV + paid gate): https://allowlatch.vercel.app/#case

## Operator

- Vercel needs dedicated `ALLOWLATCH_RECEIPT_SECRET`, `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` + `WALLET_PRIVATE_KEY` or `ALLOWLATCH_X402_PAY_TO`
- OpenServ host (`npm run deploy:host`) is **optional fallback** only — see [HOSTED.md](./HOSTED.md)

Monetization: [MONETIZE.md](./MONETIZE.md) · Embed: [EMBED.md](./EMBED.md) · Security: [SECURITY.md](./SECURITY.md)
