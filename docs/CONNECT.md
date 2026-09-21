# Connect to AllowLatch (for humans & their agents)

You do **not** run a server. You do **not** need API keys, `.env`, or CDP secrets.

## Two surfaces

| Surface | What it is | Always on? |
|---------|------------|------------|
| **Website** https://allowlatch.vercel.app | Draft mandate → **Go live** → try ALLOW/DENY/ESCALATE via `/api/gate` (free). Then **Connect your agent**. | Yes (Vercel) |
| **OpenServ AllowLatch Gate** | Production path for agents: **$0.025** x402 per call | Only while the operator keep-alive is up. `gate.isActive` can be **true while payWorkflow hangs** — still treat timeout as DENY. Website `/api/gate` stays up independently. |

Install paths (SDK / MCP / skill / OpenServ): https://allowlatch.vercel.app/#install  
Live Base case: https://allowlatch.vercel.app/#case

## Try it on the website (no agent)

1. Open https://allowlatch.vercel.app → **Try AllowLatch now**
2. Load example mandate → **Draft** → **Apply**
3. Click **Go live (server gate)** — policy on server gate + real allow-receipts
4. Click **Connect your agent** — copy instruction / code / MCP into your agent
5. Click spend scenarios here to verify ALLOW / DENY / ESCALATE

Rules stay on AllowLatch. Your agent must still call the **paid** OpenServ gate (or the Connect pack’s `assertSpend`) before signing — do not treat a downloaded JSON as enforcement.

## What you say to your own agent

> Connect to AllowLatch Gate on OpenServ (discover `/allowlatch/i` or https://allowlatch.vercel.app/api/host-info).  
> Set my spending mandate: Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap allowed. Ask me above $8. No meme coins.  
> Before any spend, call AllowLatch (`assertSpend`). If it denies or times out, stop. If it escalates, ask me. Never invent ALLOW.

## What happens behind the scenes

```
You → your agent → OpenServ x402 ($0.025) → AllowLatch Gate (hosted)
                                      ├─ SERV drafts / revises / explains (operator key)
                                      ├─ engine.ts allow/deny/escalate (never LLM)
                                      └─ your wallet / AgentKit signs only after ALLOW (+ receipt)
```

- **You** never see `SERV_API_KEY` or `CDP_*`, and never run `npm run dev`.
- **Your agent** discovers **AllowLatch Gate** and pays **$0.025** (or an evaluate pack).
- Public endpoints (also on `GET https://allowlatch.vercel.app/api/host-info`):
  - Paywall: https://platform.openserv.ai/workspace/paywall/d5bd76ab6637492c8dea60fabb590b53
  - Trigger: https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53
- Execution requires an **allow-receipt** (`jti`); see [ARCHITECTURE.md](./ARCHITECTURE.md).
- Embed into your agent: [EMBED.md](./EMBED.md).
- How we keep the gate online (operator only): [HOSTED.md](./HOSTED.md).

## For agent builders

```ts
import { assertSpend, allowLatchActionProvider } from 'allowlatch'
// or MCP: npx allowlatch-mcp
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

Or set `ALLOWLATCH_TRIGGER_URL` from host-info and use `assertSpend` / `createGatedAgentKit` — see [EMBED.md](./EMBED.md).

See `examples/connect-as-agent.ts` · `examples/live-finish.ts`.  
**Monetization:** [MONETIZE.md](./MONETIZE.md).

## Demo UI

https://allowlatch.vercel.app — try the story; live SERV when configured. **Not** something you self-host to use AllowLatch.

## Operators (AllowLatch maintainers only)

```bash
# Host .env — never give to end users
SERV_API_KEY=...
OPENSERV_USER_API_KEY=...   # OpenServ dashboard — for cloud deploy
npm run deploy:host         # preferred always-on (Fly container + go-live)
# or: npm run dev           # local tunnel (dev only — laptop must stay awake)
```

After deploy, confirm `host-info.gate.isActive` **and** a real `payWorkflow` succeeds (discover can lag). Details: [HOSTED.md](./HOSTED.md).
