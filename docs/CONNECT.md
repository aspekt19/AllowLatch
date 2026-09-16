# Connect to SpendGate (for humans & their agents)

## Two sides

| Side | What runs | Secrets |
|------|-----------|---------|
| **Owner agent** (yours) | Policy Copilot: draft / revise / explain | Your `SERV_API_KEY` — one explicit OpenServ Reasoning console step (no SIWE yet) |
| **SpendGate host** (gate) | `apply_policy` · `evaluate_intent` · `execute_gated_transfer` | Host CDP only if live execute; **never** your SERV key |

SpendGate does **not** store end-user Reasoning keys.

## What you say to your agent

> Connect to SpendGate. First draft my spending mandate with my Reasoning key, then enforce it on SpendGate:  
> Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap allowed. Ask me above $8. No meme coins.  
> Before any spend, ask SpendGate. If it denies, stop. If it escalates, ask me.

## What happens behind the scenes

```
You → your agent
         ├─ SERV (your key) → draft / revise / explain MandatePolicy
         └─ OpenServ x402 → SpendGate host
                              ├─ apply_policy (JSON only)
                              ├─ engine.ts allow/deny/escalate
                              └─ AgentKit only after ALLOW (host CDP, if live)
```

- **One explicit step:** create an OpenServ Reasoning key and give it to *your* agent (env / agent secrets). Not SIWE for now.
- **SpendGate host** never sees that key. Our host `SERV_API_KEY` is only for our own / operator use.
- **x402** (~$0.01 demo) pays the gate call; discovery needs no key.

## For agent builders

```ts
import { PlatformClient } from '@openserv-labs/client'
import { ownerDraftPolicy, gateApplyPrompt } from './src/owner/copilot.js'

// 1) Owner-side Copilot (requires SERV_API_KEY in *this* process)
const { draft } = await ownerDraftPolicy(
  'max $10/tx, $40/day, USDC+ETH, Uniswap only, ask above $8'
)
// show draft.conflicts / questions to the human; revise if needed

// 2) Keyless gate — send policy JSON only
const client = new PlatformClient()
const services = await client.payments.discoverServices()
const spendgate = services.find((s) => /spendgate/i.test(s.name))

await client.payments.payWorkflow({
  workflowId: spendgate.workflowId,
  input: { prompt: gateApplyPrompt({ policy: draft.policy }) },
})
```

See `examples/owner-copilot.ts` and `examples/connect-as-agent.ts`.

## Demo without OpenServ

Open https://spendgate.vercel.app — local Policy Copilot review UI (offline draft). Same gate idea; not the live skill path.

## Operators (SpendGate host)

```bash
# Gate only — no SERV required for consumer traffic
# optional live execute:
# CDP_API_KEY_ID=...
npm run dev

# optional: SERV_API_KEY on the host unlocks operator Copilot for *our* use only
```
