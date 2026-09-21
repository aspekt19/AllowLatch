# Connect to AllowLatch (for humans & their agents)

You do **not** run a server. You do **not** need API keys, `.env`, or CDP secrets.

## Two surfaces

| Surface | What it is | Always on? |
|---------|------------|------------|
| **Website** https://allowlatch.vercel.app | Draft mandate → **Go live** → try ALLOW/DENY/ESCALATE via `/api/gate` (free). Then **Connect your agent** (`gateUrl` + `sessionSeal`). | **Yes** (Vercel) |
| **OpenServ AllowLatch Gate** | Paid marketplace path: **$0.025** x402 per call | Only while the operator host is reachable. `gate.isActive` can be true while `payWorkflow` hangs — timeout → DENY. |

Install paths (SDK / MCP / skill / OpenServ): https://allowlatch.vercel.app/#install  
Live Base case: https://allowlatch.vercel.app/#case  
Agent skill (any LLM): [`skills/allowlatch/SKILL.md`](../skills/allowlatch/SKILL.md)

## Try it on the website (no agent)

1. Open https://allowlatch.vercel.app → **Try AllowLatch now**
2. Load example mandate → **Draft** → **Apply**
3. Click **Go live (server gate)** — policy on server gate + real allow-receipts (`sessionSeal` saved in the browser)
4. Click **Connect your agent** — copy instruction / code / MCP into your agent
5. Click spend scenarios here to verify ALLOW / DENY / ESCALATE

Rules stay on AllowLatch. Your agent should call `assertSpend` with the Connect pack’s **`gateUrl` + `sessionSeal`** (always-on). OpenServ x402 is optional when the paid host is online.

## What you say to your own agent

> Connect to AllowLatch. Prefer the Connect pack from https://allowlatch.vercel.app (gateUrl + sessionSeal).  
> Set my spending mandate: Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap allowed. Ask me above $8. No meme coins.  
> Before any spend, call AllowLatch (`assertSpend`). If it denies or times out, stop. If it escalates, ask me. Never invent ALLOW.

## What happens behind the scenes

```
You → website Go live → /api/gate (always-on) → Connect pack
You → your agent → assertSpend(gateUrl, sessionSeal) → ALLOW + receipt → wallet signs

Optional paid path:
You → your agent → OpenServ x402 ($0.025) → AllowLatch Gate host → ALLOW + receipt
```

- **You** never see `SERV_API_KEY` or `CDP_*`, and never run `npm run dev`.
- Public OpenServ endpoints (also on `GET https://allowlatch.vercel.app/api/host-info`):
  - Paywall: https://platform.openserv.ai/workspace/paywall/d5bd76ab6637492c8dea60fabb590b53
  - Trigger: https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53
- Execution requires an **allow-receipt** (`jti`); see [ARCHITECTURE.md](./ARCHITECTURE.md).
- Embed into your agent: [EMBED.md](./EMBED.md).
- How we keep the paid OpenServ host online (operator only): [HOSTED.md](./HOSTED.md).

## For agent builders

```ts
import { assertSpend, allowLatchActionProvider } from 'allowlatch'
// or MCP: npx allowlatch-mcp

// Preferred after website Go live:
await assertSpend({
  policyId: 'web-…',
  gateUrl: 'https://allowlatch.vercel.app/api/gate',
  sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
  intent: { action: 'transfer', amountUsd: 5, toAddress: '0x…', symbol: 'USDC' },
})
```

Apply once with `ownerId` (save returned `ownerToken`). Optional: EIP-712 `ownerSig` over `policyHash` — see [SECURITY.md](./SECURITY.md).

```ts
import { PlatformClient } from '@openserv-labs/client'

const client = new PlatformClient()
const services = await client.payments.discoverServices()
const allowlatch = services.find((s) => /allowlatch/i.test(s.name))

await client.payments.payWorkflow({
  triggerUrl: allowlatch.webhookUrl,
  input: {
    prompt:
      'draft and apply mandate: max $10/tx, $40/day, USDC+ETH, Uniswap only, ask above $8',
  },
})
```

Or set `ALLOWLATCH_GATE_URL` / `ALLOWLATCH_SESSION_SEAL` from the Connect pack — see [EMBED.md](./EMBED.md).

See `examples/connect-as-agent.ts` · `examples/live-finish.ts`.  
**Monetization:** [MONETIZE.md](./MONETIZE.md).

## Demo UI

https://allowlatch.vercel.app — dialog story + Go live + Connect + Install + Live case.

## Operator (AllowLatch maintainers only)

```bash
npm run deploy:host         # preferred always-on OpenServ Cloud (retries 502; reuses container)
# or Dockerfile on Railway/Fly with DISABLE_TUNNEL=true
npm run dev                 # incident tunnel only
```

After deploy, confirm `host-info.gate.isActive` **and** a real `payWorkflow` succeeds (discover can lag; machines can sleep). Details: [HOSTED.md](./HOSTED.md).
