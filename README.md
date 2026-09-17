# AllowLatch

**SERV Policy Copilot + spending turnstile** for financial AI agents on Base (USDC / AgentKit).

**Live demo:** https://allowlatch.vercel.app  
**Repo:** https://github.com/aspekt19/AllowLatch  
**Connect:** [docs/CONNECT.md](./docs/CONNECT.md) · [llms.txt](./llms.txt) · [agent.json](./agent.json)

> Reasoning drafts the law. Code judges every spend. AgentKit only after ALLOW + allow-receipt.

No custody. No end-user API keys — host holds SERV (+ optional CDP). Agents pay x402 ($0.025) or an evaluate pack ($1 / 100). Optional on-chain Spend Permissions: `ALLOWLATCH_ENFORCEMENT=hybrid`.

> Product name is **AllowLatch**. Unrelated third-party sites with similar names are not this project.

## For end users

Tell your agent:

> Connect to AllowLatch. Enforce: max $10/tx, $40/day, only USDC and ETH, ask me above $8. Before any spend, ask AllowLatch.

- Cursor skill: `.cursor/skills/allowlatch`
- Demo UI: https://allowlatch.vercel.app
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
npm run test                # engine + receipt unit tests
npm run ui                  # dialog UI (live SERV via /api/copilot when key set)
npm run wow                 # full SERV → injection → gate → explain → AgentKit
npm run battle              # Spender → gate → AgentKit dry-run
npm run connect             # discover AllowLatch as another agent
npm run agent:gated         # new AgentKit spender with gate baked in (needs http:gate)
npm run http:gate           # framework-agnostic HTTP evaluate/execute
npm run dev                 # provision + run OpenServ host
```

Host `.env`: `SERV_API_KEY` (required for Copilot), optional `CDP_*` for live execute.

## Pitch

Say the rules in words. SERV turns them into a policy you can review. Without ALLOW, AgentKit cannot spend.

## License

ISC

## For coding agents

See [AGENTS.md](./AGENTS.md), [llms.txt](./llms.txt), and [`.cursorrules`](./.cursorrules).
