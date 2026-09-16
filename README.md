# SpendGate

**Policy Copilot + spending turnstile** for financial AI agents on Base (USDC / AgentKit).

**Live demo:** https://spendgate.vercel.app  
**Repo:** https://github.com/aspekt19/SpendGate  
**Connect (no API keys for users):** [docs/CONNECT.md](./docs/CONNECT.md) · [llms.txt](./llms.txt) · [agent.json](./agent.json)

Human mandate → strict USDC policy → every spend is **allow / deny / escalate** → AgentKit moves funds **only after ALLOW**. Non-custodial.

> SERV Hackathon Edition 01 · track: **Coinbase AgentKit**

## For end users (the product)

You do **not** edit `.env` or paste secret keys.

Tell your agent:

> Connect to SpendGate. Enforce: max $10/tx, $40/day, only USDC and ETH, ask me above $8. Before any spend, ask SpendGate.

Your agent discovers SpendGate on OpenServ (x402), drafts the policy, and gates spends. Host secrets stay with the SpendGate operator.

- Cursor skill: `.cursor/skills/spendgate` (also installed in your user Agent Store as `spendgate`)
- Demo UI: https://spendgate.vercel.app

## Problem

An agent with a funded Base wallet can drain itself via loops, bad addresses, or over-eager swaps. Prompt-level “be careful” is not a control.

## Solution

| Layer | Role |
|-------|------|
| OpenServ agent (x402) | What other agents connect to |
| SERV Reasoning | Policy Copilot (host key) |
| Deterministic engine | Caps, allowlists, escalate — not LLM judgment |
| Coinbase AgentKit | Signs USDC **only after ALLOW** |

## Capabilities

- `draft_policy` / `revise_mandate` / `apply_policy` — Policy Copilot
- `evaluate_intent` / `explain_decision` — gate + explanation
- `execute_gated_transfer` — AgentKit only after ALLOW
- `compile_mandate` / `get_policy` / `reset_ledger` — helpers

## Operators / developers

```bash
npm install
npm run ui                  # local Policy Copilot demo UI
npm run reasoning:copilot   # host SERV cycle
npm run battle              # Spender → gate → AgentKit dry-run
npm run connect             # discover SpendGate as another agent
npm run dev                 # provision + run OpenServ host (host .env only)
```

Host `.env` (never give to end users): `SERV_API_KEY`, optional `CDP_*` for live execute.  
Live CDP checklist: [docs/BATTLE.md](./docs/BATTLE.md) · Product: [docs/PRODUCT.md](./docs/PRODUCT.md)

## Pitch (one line)

Say the rules to your agent; SpendGate turns them into a hard turnstile so AgentKit cannot spend outside them.

## Hackathon notes

- Enable data collection: `console.openserv.ai/settings/organization`
- Submit with a public X post tagging **@openservai** + the official form
- Deadline: 28 September 2026 00:00 UTC

## License

ISC

## For coding agents

See [AGENTS.md](./AGENTS.md), [llms.txt](./llms.txt), and [`.cursorrules`](./.cursorrules).
