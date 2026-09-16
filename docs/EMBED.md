# Embed a MandatePolicy in your agent

The demo site stores rules only in the browser until you export them.
To enforce the same rules in **your** agent:

## 1. Export from https://spendgate.vercel.app

1. Draft → **Apply policy**
2. Click **Download JSON** or **Copy JSON** (Active policy panel)
3. Save as e.g. `mandate-policy.json` next to your agent

## 2. Gate every spend before signing

Use the same deterministic engine as SpendGate (`evaluateIntent` in `src/policy/engine.ts`).

```ts
import { readFileSync } from 'node:fs'
import { MandatePolicySchema, type SpendIntent } from './src/policy/schema.js'
import { evaluateIntent, freshLedger, commitIntent } from './src/policy/engine.js'

const policy = MandatePolicySchema.parse(
  JSON.parse(readFileSync('./mandate-policy.json', 'utf8'))
)
let ledger = freshLedger()

async function beforeSign(intent: SpendIntent) {
  const result = evaluateIntent(policy, intent, ledger)
  if (result.decision === 'deny') throw new Error(result.reasons.join('; '))
  if (result.decision === 'escalate') {
    // ask the human; only continue if they say yes
    throw new Error('ESCALATE: wait for human approval')
  }
  // ALLOW — now AgentKit / wallet may sign
  ledger = commitIntent(ledger, intent)
  return result
}
```

Reference script: `examples/gate-with-policy.ts`

## 3. Agent instruction (required)

Put this in the agent system prompt / skill:

> Before any transfer, swap, or payment, call the local SpendGate gate (`beforeSign` / `evaluateIntent`) with the intent. On DENY do not sign. On ESCALATE ask me. Never bypass the gate.

Without that discipline, JSON on disk does nothing.

## 4. Change or remove rules

| Goal | What to do |
|------|------------|
| New limits | Re-draft on the site (or revise), export again, replace `mandate-policy.json` |
| No limits | Delete / unload the JSON and remove the gate call from the agent path |
| Clear on the demo site only | **Clear rules** — does not change your agent’s file |

## 5. Stronger options later

- Keep calling the live SpendGate host over x402 instead of a local file
- On-chain vault / custody — rules cannot be skipped by a naughty agent (not v1)
