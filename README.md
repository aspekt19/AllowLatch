# AllowLatch

**SERV Policy Copilot + spending turnstile** for financial AI agents on Base (USDC). Works with stacks like OpenServ + Coinbase AgentKit - not limited to one SDK.

**Live demo:** https://allowlatch.vercel.app  
**Repo:** https://github.com/aspekt19/AllowLatch  
**Connect:** [docs/CONNECT.md](./docs/CONNECT.md) · [llms.txt](./llms.txt) · [agent.json](./agent.json)  
**Security:** [docs/SECURITY.md](./docs/SECURITY.md) · [docs/AUDIT.md](./docs/AUDIT.md)

> Reasoning drafts the law. Code judges every spend. The agent signs only after ALLOW + allow-receipt.

No end-user API keys — **you never run the host**. Discover **AllowLatch Gate** on OpenServ, pay **$0.025**/call or prepaid pack credits via `buy_evaluate_pack` (fixed credits per x402; default 3 ≈ $0.008/check). Default enforcement: **hybrid**. Embed: `npm i allowlatch` · MCP: `npx allowlatch-mcp` · Action provider: `allowLatchActionProvider()`.

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
| OpenServ x402 | How other agents connect & pay |

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
