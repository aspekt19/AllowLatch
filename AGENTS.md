# AI agents — where to look

Entry point for coding agents (Cursor, OpenServ, Claude Code, etc.). Human-facing product copy stays in [README.md](./README.md).

## Read first

| What | Path |
|------|------|
| **Repo rules (stack, architecture, coding)** | [`.cursorrules`](./.cursorrules) |
| Product overview & scripts | [README.md](./README.md) |
| Product definition | [`docs/PRODUCT.md`](./docs/PRODUCT.md) |
| Connect (end-user / other agents) | [`docs/CONNECT.md`](./docs/CONNECT.md) |
| Machine card / llms | [`agent.json`](./agent.json) · [`llms.txt`](./llms.txt) |
| Cursor skill | [`.cursor/skills/spendgate/SKILL.md`](./.cursor/skills/spendgate/SKILL.md) |
| Policy schema | [`src/policy/schema.ts`](./src/policy/schema.ts) |
| Deterministic gate | [`src/policy/engine.ts`](./src/policy/engine.ts) |
| OpenServ agent | [`src/agent.ts`](./src/agent.ts) |
| Owner-side Copilot | [`src/owner/copilot.ts`](./src/owner/copilot.ts) |
| AgentKit gated executor | [`src/executor/gated-executor.ts`](./src/executor/gated-executor.ts) |
| Battle Spender CLI | [`src/spender/battle.ts`](./src/spender/battle.ts) |
| Live battle checklist | [`docs/BATTLE.md`](./docs/BATTLE.md) |
| SERV Reasoning client | [`src/llm/serv-reasoning.ts`](./src/llm/serv-reasoning.ts) |
| Mandate compile / Policy Copilot | [`src/llm/compile-mandate.ts`](./src/llm/compile-mandate.ts) |
| Explain gate decision (SERV) | [`src/llm/explain-decision.ts`](./src/llm/explain-decision.ts) |
| Dialog UI | [`web/`](./web/) |

## SERV Reasoning (how we use it)

Docs: https://docs.openserv.ai/serv-reasoning/

- **Host Copilot** — draft / revise / explain with host `SERV_API_KEY` (product path). Multipath + `serv_prompt_guard` + `serv_shadow_agent`.
- **Deterministic gate** — allow/deny/escalate stays in `engine.ts` (never LLM).
- **Connect** — end users need no keys; x402 pays the call.
- Optional BYO: [`src/owner/copilot.ts`](./src/owner/copilot.ts) if an owner wants their own Reasoning key.
- Env: `SERV_API_KEY`, optional `SERV_MODEL` / `SERV_COMPILE_MODEL` / `SERV_REASONING_EFFORT`

## Surfaces

| Surface | Role |
|---------|------|
| **OpenServ host** (`npm run dev`) | Full product: SERV Copilot + gate + optional execute |
| **WOW CLI** (`npm run wow`) | Theater: messy mandate → injection → gate → explain → AgentKit |
| **Vite UI** (`npm run ui`) | Same story; `/api/copilot` → live SERV when key set |

## Runtime checklist

1. Never commit `.env` / `.openserv.json` / CDP secrets.
2. Never ask end users for `SERV_API_KEY`.
3. Policy allow/deny must go through `evaluateIntent` in `engine.ts`.
4. AgentKit signs only after ALLOW (or escalate + humanApproved).
5. Product name is **SpendGate** (not MandateGuard).

## Verify

```bash
npm run demo
npm run wow
npm run battle
npm run typecheck
npm run ui:build
```