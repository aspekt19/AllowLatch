# Connect to AllowLatch (for humans & their agents)

You do **not** run a server. You do **not** need API keys, `.env`, or CDP secrets.

## What you say to your agent

> Connect to AllowLatch on OpenServ. Set my spending mandate:  
> Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap allowed. Ask me above $8. No meme coins.  
> Before any spend, ask AllowLatch. If it denies, stop. If it escalates, ask me.

That's the product. **AllowLatch Gate is hosted** — your agent discovers it and pays x402.

## What happens behind the scenes

```
You → your agent → OpenServ x402 → AllowLatch Gate (hosted)
                                      ├─ SERV drafts / revises / explains (operator key)
                                      ├─ engine.ts allow/deny/escalate (never LLM)
                                      └─ your wallet / AgentKit signs only after ALLOW (+ receipt)
```

- **You** never see `SERV_API_KEY` or `CDP_*`, and never run `npm run dev`.
- **Your agent** discovers **AllowLatch Gate** (`/allowlatch/i`) and pays **$0.025** (or an evaluate pack).
- Public endpoints (also on `GET https://allowlatch.vercel.app/api/host-info`):
  - Paywall: https://platform.openserv.ai/workspace/paywall/d5bd76ab6637492c8dea60fabb590b53
  - Trigger: https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53
- Execution requires an **allow-receipt** (`jti`); see [ARCHITECTURE.md](./ARCHITECTURE.md).
- Embed into your agent: [EMBED.md](./EMBED.md).
- How we keep the gate online (operator only): [HOSTED.md](./HOSTED.md).

## For agent builders

```ts
import { PlatformClient } from '@openserv-labs/client'

const client = new PlatformClient()
const services = await client.payments.discoverServices()
const allowlatch = services.find((s) => /allowlatch/i.test(s.name))

await client.payments.payWorkflow({
  triggerUrl: allowlatch.webhookUrl, // or workflowId when present
  input: {
    prompt:
      'draft and apply mandate: max $10/tx, $40/day, USDC+ETH, Uniswap only, ask above $8',
  },
})
```

Or set `ALLOWLATCH_TRIGGER_URL` from host-info / the table above and use `assertSpend` / `createGatedAgentKit` — see [EMBED.md](./EMBED.md).

See `examples/connect-as-agent.ts`.  
**Monetization:** [MONETIZE.md](./MONETIZE.md).

## Demo UI

https://allowlatch.vercel.app — try the story; live SERV when configured. **Not** something you self-host to use AllowLatch.

## Operators (AllowLatch maintainers only)

```bash
# Host .env — never give to end users
SERV_API_KEY=...
OPENSERV_USER_API_KEY=...   # OpenServ dashboard — for cloud deploy
npm run deploy:openserv     # preferred always-on
# or: npm run dev           # local tunnel (dev only)
```

Details: [HOSTED.md](./HOSTED.md).
