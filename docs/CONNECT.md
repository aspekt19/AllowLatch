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
                                      ├─ SERV drafts/explains policy (host key)
                                      ├─ engine.ts allow/deny/escalate
                                      └─ AgentKit only after ALLOW (host CDP, if live)
```

- **You** never see `SERV_API_KEY` or `CDP_*`.
- **Your agent** discovers SpendGate via OpenServ (`discoverServices` → name `SpendGate`) and pays a tiny x402 fee (demo price ~$0.01) or uses the paywall page.
- **SpendGate host** (us / the operator) runs `npm run dev` with secrets and keeps the gate online.

## For agent builders (still no end-user secrets)

```ts
import { PlatformClient } from '@openserv-labs/client'

const client = new PlatformClient() // discovery needs no key
const services = await client.payments.discoverServices()
const spendgate = services.find((s) => /spendgate/i.test(s.name))

// When the owner's agent has a funded wallet for x402:
await client.payments.payWorkflow({
  workflowId: spendgate.workflowId,
  input: {
    prompt:
      'draft and apply mandate: max $10/tx, $40/day, USDC+ETH, Uniswap only, ask above $8',
  },
})
```

See `examples/connect-as-agent.ts`.

## Demo without OpenServ

Open https://spendgate.vercel.app — local Policy Copilot review UI (offline draft). Same gate idea; not the live skill path.

## Operators (host only)

If **you** run the SpendGate service:

```bash
# .env on the host — never give these to end users
SERV_API_KEY=...
# optional live execute:
# CDP_API_KEY_ID=...
npm run dev
```

Then share this page / `llms.txt` / the Cursor skill so other agents can connect.
