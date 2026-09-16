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

- **Owner agent** — draft / revise / explain with the **owner’s** `SERV_API_KEY` via [`src/owner/copilot.ts`](./src/owner/copilot.ts). One console key step; no SIWE yet. Never send that key to the host.
- **Host** — keyless gate: `apply_policy` / `evaluate_intent` / `execute_gated_transfer`. Optional host `SERV_API_KEY` only for operator self/dev Copilot.
- **Deterministic gate** — allow/deny/escalate stays in `engine.ts` (never LLM)
- Day-one defaults: small model, versioned system prompt, structured JSON + Zod, `reasoning_effort`, no tight `max_tokens`
- Copilot extras: Multipath (`*-serv-multipath`), `serv_prompt_guard`, `serv_shadow_agent`
- Env (owner or operator): `SERV_API_KEY`, optional `SERV_MODEL` / `SERV_COMPILE_MODEL` / `SERV_REASONING_EFFORT`

## Surfaces (do not conflate)

| Surface | Role |
|---------|------|
| **Owner Copilot** (`npm run owner:copilot`) | SERV draft → gate `apply_policy` prompt |
| **OpenServ host** (`npm run dev`) | Keyless gate (+ optional operator SERV) |
| **Vite dialog UI** (`npm run ui`) | Demo UX; offline draft + same `engine.ts` |

## Runtime checklist

1. Never commit `.env` / `.openserv.json` / CDP secrets.
2. Never store end-user `SERV_API_KEY` on the SpendGate host.
3. Policy allow/deny must go through `evaluateIntent` in `engine.ts`.
4. AgentKit signs only after ALLOW (or escalate + humanApproved).
5. Product name is **SpendGate** (not MandateGuard).

## Verify

```bash
npm run demo
npm run battle
npm run owner:copilot
npm run typecheck
npm run ui:build
```