# AllowLatch

**SERV Policy Copilot + spending turnstile** for financial AI agents on Base (USDC). Works with stacks like OpenServ + Coinbase AgentKit - not limited to one SDK.

**Live demo:** https://allowlatch.vercel.app  
**Repo:** https://github.com/aspekt19/AllowLatch  
**Guide:** [docs/GUIDE.md](./docs/GUIDE.md) · **Connect:** [docs/CONNECT.md](./docs/CONNECT.md) · [llms.txt](./llms.txt) · [agent.json](./agent.json)  
**Security:** [docs/SECURITY.md](./docs/SECURITY.md) · [docs/AUDIT.md](./docs/AUDIT.md)

> Reasoning drafts the law. Code judges every spend. The agent signs only after ALLOW + allow-receipt.

No end-user API keys — **you never run the host**. **Primary:** always-on https://allowlatch.vercel.app/api/gate (website free to try; agents pay **$0.025 USDC** x402 on Base). OpenServ is an **optional fallback**. Embed: `npm i allowlatch` · MCP: `npx allowlatch-mcp` · skill: `skills/allowlatch`. Full guide: [docs/GUIDE.md](./docs/GUIDE.md).

> Product name is **AllowLatch**. Unrelated third-party sites with similar names are not this project.

## For end users

Tell your agent:

> Connect to AllowLatch. Enforce: max $10/tx, $40/day, only USDC and ETH, ask me above $8. Before any spend, ask AllowLatch.

- Agent skill (any LLM): [`skills/allowlatch/SKILL.md`](./skills/allowlatch/SKILL.md) (Cursor mirror: `.cursor/skills/allowlatch`)
- Demo UI: https://allowlatch.vercel.app
- Connect: [docs/CONNECT.md](./docs/CONNECT.md) · Hosted ops: [docs/HOSTED.md](./docs/HOSTED.md)

## Solution

| Layer | Role |
|-------|------|
| SERV Reasoning (host) | Draft / revise / explain - Multipath, prompt_guard, shadow |
| Deterministic engine | Caps, allowlists, escalate - never LLM judgment |
| Coinbase AgentKit | Signs USDC **only after ALLOW** |
| Vercel `/api/gate` + native x402 | Always-on connect & pay for agents |
| OpenServ x402 | Optional marketplace fallback |

## Scripts

```bash
npm install
npm run test                # engine + receipt unit tests
npm run ui                  # dialog UI (live SERV via /api/copilot when key set)
npm run wow                 # full SERV → injection → gate → explain → AgentKit
npm run battle              # Spender → gate → AgentKit dry-run
npm run connect             # discover hosted AllowLatch Gate as another agent
npm run agent:gated         # AgentKit spender with gate baked in
npm run http:gate           # local HTTP evaluate/execute (builder/dev)
npm run deploy:host         # operator: always-on OpenServ Cloud host
npm run dev                 # operator: local tunnel host (dev)
```

End users: [docs/CONNECT.md](./docs/CONNECT.md). Operator hosting: [docs/HOSTED.md](./docs/HOSTED.md).  
Operator `.env`: `SERV_API_KEY`, `OPENSERV_USER_API_KEY` (cloud deploy), optional `CDP_*`.

## Pitch

Say the rules in words. SERV turns them into a policy you can review. Without ALLOW, the agent cannot spend.

## License

ISC

## For coding agents

See [AGENTS.md](./AGENTS.md), [llms.txt](./llms.txt), and [`.cursorrules`](./.cursorrules).
