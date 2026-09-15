# AI agents — where to look

Entry point for coding agents (Cursor, OpenServ, Claude Code, etc.). Human-facing product copy stays in [README.md](./README.md).

## Read first

| What | Path |
|------|------|
| **Repo rules (stack, architecture, coding)** | [`.cursorrules`](./.cursorrules) |
| Product overview & scripts | [README.md](./README.md) |
| Policy schema | [`src/policy/schema.ts`](./src/policy/schema.ts) |
| Deterministic gate | [`src/policy/engine.ts`](./src/policy/engine.ts) |
| OpenServ agent | [`src/agent.ts`](./src/agent.ts) |
| AgentKit gated executor | [`src/executor/gated-executor.ts`](./src/executor/gated-executor.ts) |
| Battle Spender CLI | [`src/spender/battle.ts`](./src/spender/battle.ts) |
| Live battle checklist | [`docs/BATTLE.md`](./docs/BATTLE.md) |
| Dialog UI | [`web/`](./web/) |

## Two surfaces (do not conflate)

| Surface | Role |
|---------|------|
| **OpenServ agent** (`npm run dev`) | Production brain: `compile_mandate`, `evaluate_intent`, `execute_gated_transfer`, x402 |
| **Vite dialog UI** (`npm run ui`) | Demo UX; offline heuristic compile + same `engine.ts` |

## Runtime checklist

1. Never commit `.env` / `.openserv.json` / CDP secrets.
2. Policy allow/deny must go through `evaluateIntent` in `engine.ts`.
3. AgentKit signs only after ALLOW (or escalate + humanApproved).
4. Product name is **SpendGate** (not MandateGuard).

## Verify

```bash
npm run demo
npm run battle
npm run typecheck
npm run ui:build
```