# AllowLatch

**SERV Policy Copilot + spending turnstile** for financial AI agents on Base (USDC). Works with stacks like OpenServ + Coinbase AgentKit - not limited to one SDK.

**Live demo:** https://allowlatch.vercel.app  
**Repo:** https://github.com/aspekt19/AllowLatch  
**Guide:** [docs/GUIDE.md](./docs/GUIDE.md) · **Connect:** [docs/CONNECT.md](./docs/CONNECT.md) · **Pitch:** [docs/PITCH.md](./docs/PITCH.md) · [llms.txt](./llms.txt) · [agent.json](./agent.json)  
**Security:** [docs/SECURITY.md](./docs/SECURITY.md) · [docs/AUDIT.md](./docs/AUDIT.md)

> Reasoning drafts the law. Code judges every spend. On the gated path the agent signs only after ALLOW and a consumed allow-receipt (escalate needs owner approval).

For owners of **AI agents with Coinbase AgentKit / CDP** (compatible gated signers welcome). No end-user **SERV/CDP host** keys — **you never run the host**. Agents that call the gate still need a **Base USDC payer** for x402 ($0.025). **Required:** Go live → **Copy for my AI** → `createGatedAgentKit({ kind: 'site' })` (`assertSpend` alone is advisory). Optional on-chain ceiling via agent `hybrid_plan` (host `sync_wallet` is operator-advanced). Do not put the funded private key in the agent. The site does **not** ask you to connect MetaMask. **Primary:** https://allowlatch.vercel.app/api/gate. OpenServ is optional fallback. Embed: `npm i allowlatch` · MCP: `npx allowlatch-mcp` · skill: `skills/allowlatch`. Guide: [docs/GUIDE.md](./docs/GUIDE.md).

> Product name is **AllowLatch**. Unrelated third-party sites with similar names are not this project.

## For end users

Tell your agent:

> Connect to AllowLatch via https://allowlatch.vercel.app (Go live → Copy for my AI). Use createGatedAgentKit({ kind: "site" }) with gateUrl + sessionSeal. AgentKit/CDP wallet. assertSpend alone is advisory.

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
npm run connect             # optional: discover OpenServ AllowLatch Gate (fallback)
npm run agent:gated         # AgentKit spender with gate baked in
npm run http:gate           # local HTTP evaluate/execute (builder/dev)
npm run deploy:host         # operator: optional OpenServ keep-alive (best-effort; not the primary gate)
npm run dev                 # operator: local tunnel host (dev)
```

End users: [docs/CONNECT.md](./docs/CONNECT.md). Operator hosting: [docs/HOSTED.md](./docs/HOSTED.md).  
Operator `.env`: `SERV_API_KEY`, `OPENSERV_USER_API_KEY` (cloud deploy), optional `CDP_*`.

## Pitch

Say the rules in words. SERV turns them into a policy you can review. On the AgentKit gated path (`createGatedAgentKit` + receipt; optional `hybrid_plan` ceiling), spends need ALLOW — a funded private key in the agent can still bypass; keep balances small until audit.

## License

ISC

## For coding agents

See [AGENTS.md](./AGENTS.md), [llms.txt](./llms.txt), and [`.cursorrules`](./.cursorrules).
