# Connect to SpendGate (for humans & their agents)

You do **not** need API keys, `.env`, or CDP secrets.

## What you say to your agent

> Connect to SpendGate on OpenServ. Set my spending mandate:  
> Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap allowed. Ask me above $8. No meme coins.  
> Before any spend, ask SpendGate. If it denies, stop. If it escalates, ask me.

That’s the product.

## What happens behind the scenes

```
You → your agent → OpenServ x402 → SpendGate host
                                      ├─ SERV drafts / revises / explains (host key)
                                      ├─ engine.ts allow/deny/escalate (never LLM)
                                      └─ AgentKit only after ALLOW (host CDP, if live)
```

- **You** never see `SERV_API_KEY` or `CDP_*`.
- **Your agent** discovers SpendGate (`discoverServices` → name `SpendGate`) and pays a tiny x402 fee (~$0.01 demo) — that payment is how we attribute / bill usage.
- **SpendGate host** runs with SERV (Policy Copilot) + optional CDP.

## Why SERV is on the host

So the wow path is complete: messy mandate → conflicts → injection resisted → gate DENY/ALLOW → SERV explain. End users don’t configure Reasoning. Host credits are covered by x402 pricing (fixed fee MVP; metered later).

Optional advanced: BYO Reasoning via `src/owner/copilot.ts` if an owner insists on their own key — not required.

## For agent builders

```ts
import { PlatformClient } from '@openserv-labs/client'

const client = new PlatformClient()
const services = await client.payments.discoverServices()
const spendgate = services.find((s) => /spendgate/i.test(s.name))

await client.payments.payWorkflow({
  workflowId: spendgate.workflowId,
  input: {
    prompt:
      'draft and apply mandate: max $10/tx, $40/day, USDC+ETH, Uniswap only, ask above $8',
  },
})
```

See `examples/connect-as-agent.ts`. Full theater: `npm run wow`.

## Demo UI

https://spendgate.vercel.app — same story; live SERV when the host key is configured on the deploy.

## Operators

```bash
# Host .env — never give to end users
SERV_API_KEY=...
# optional live execute:
# CDP_API_KEY_ID=...
npm run dev
npm run wow
```
