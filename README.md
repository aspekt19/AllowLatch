# SpendGate

**SERV Policy Copilot + spending turnstile** for financial AI agents on Base (USDC / AgentKit).

**Live demo:** https://spendgate.vercel.app  
**Repo:** https://github.com/aspekt19/SpendGate  
**Connect:** [docs/CONNECT.md](./docs/CONNECT.md) · [llms.txt](./llms.txt) · [agent.json](./agent.json)

> Reasoning drafts the law. Code judges every spend. AgentKit only after ALLOW.

No custody. No end-user API keys — host holds SERV (+ optional CDP). Agents pay x402.

> SERV Hackathon Edition 01 · track: **Coinbase AgentKit**

## For end users

Tell your agent:

> Connect to SpendGate. Enforce: max $10/tx, $40/day, only USDC and ETH, ask me above $8. Before any spend, ask SpendGate.

- Cursor skill: `.cursor/skills/spendgate`
- Demo UI: https://spendgate.vercel.app
- Full theater (host): `npm run wow`

## Solution

| Layer | Role |
|-------|------|
| SERV Reasoning (host) | Draft / revise / explain — Multipath, prompt_guard, shadow |
| Deterministic engine | Caps, allowlists, escalate — never LLM judgment |
| Coinbase AgentKit | Signs USDC **only after ALLOW** |
| OpenServ x402 | How other agents connect & pay |

## Scripts

```bash
npm install
npm run ui                  # dialog UI (live SERV via /api/copilot when key set)
npm run wow                 # full SERV → injection → gate → explain → AgentKit
npm run battle              # Spender → gate → AgentKit dry-run
npm run connect             # discover SpendGate as another agent
npm run dev                 # provision + run OpenServ host
```

Host `.env`: `SERV_API_KEY` (required for Copilot), optional `CDP_*` for live execute.

## Pitch

Say the rules in words. SERV turns them into a policy you can review. Without ALLOW, AgentKit cannot spend.

## Hackathon notes

- Enable data collection: `console.openserv.ai/settings/organization`
- Submit with a public X post tagging **@openservai** + the official form
- Deadline: 28 September 2026 00:00 UTC

## License

ISC

## For coding agents

See [AGENTS.md](./AGENTS.md), [llms.txt](./llms.txt), and [`.cursorrules`](./.cursorrules).
