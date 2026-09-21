# AI agents — where to look

Entry point for coding agents (Cursor, OpenServ, Claude Code, etc.). Human-facing product copy stays in [README.md](./README.md).

## Read first

| What | Path |
|------|------|
| **Repo rules (stack, architecture, coding)** | [`.cursorrules`](./.cursorrules) |
| Product overview & scripts | [README.md](./README.md) |
| Product definition | [`docs/PRODUCT.md`](./docs/PRODUCT.md) |
| Architecture hardening | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) |
| Wallet-native Spend Permissions | [`docs/WALLET_NATIVE.md`](./docs/WALLET_NATIVE.md) (hybrid / wallet_native done) |
| Connect (end-user / other agents) | [`docs/CONNECT.md`](./docs/CONNECT.md) |
| Hosted gate (operator keep-alive) | [`docs/HOSTED.md`](./docs/HOSTED.md) · `npm run deploy:host` / `deploy:openserv` |
| Embed / gated AgentKit SDK | [`docs/EMBED.md`](./docs/EMBED.md) · `createGatedAgentKit` · `npm run agent:gated` |
| Monetization | [`docs/MONETIZE.md`](./docs/MONETIZE.md) |
| Security / threat model / checklist | [`docs/SECURITY.md`](./docs/SECURITY.md) |
| Machine card / llms / skill | [`agent.json`](./agent.json) · [`llms.txt`](./llms.txt) · [`skills/allowlatch/SKILL.md`](./skills/allowlatch/SKILL.md) · site [`#install`](https://allowlatch.vercel.app/#install) / [`#case`](https://allowlatch.vercel.app/#case) |
| Cursor skill mirror | [`.cursor/skills/allowlatch/SKILL.md`](./.cursor/skills/allowlatch/SKILL.md) |
| Policy schema | [`src/policy/schema.ts`](./src/policy/schema.ts) |
| Deterministic gate | [`src/policy/engine.ts`](./src/policy/engine.ts) |
| SQLite policy store | [`src/store/fs-store.ts`](./src/store/fs-store.ts) · [`src/store/types.ts`](./src/store/types.ts) |
| Allow-receipt | [`src/billing/receipt.ts`](./src/billing/receipt.ts) |
| EIP-712 owner apply | [`src/auth/policy-eip712.ts`](./src/auth/policy-eip712.ts) |
| npm SDK / AgentKit action / MCP | [`src/index.ts`](./src/index.ts) · [`src/sdk/allowlatch-action-provider.ts`](./src/sdk/allowlatch-action-provider.ts) · [`src/mcp/server.ts`](./src/mcp/server.ts) |
| OpenServ agent | [`src/agent.ts`](./src/agent.ts) |
| Generic HTTP gate | [`src/http/gate-server.ts`](./src/http/gate-server.ts) |
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
| **Website gate** (`/api/gate`) | Always-on free apply/evaluate + receipts on Vercel (`sessionSeal`) — **preferred Connect path** |
| **Hosted OpenServ Gate** | Paid marketplace path: discover + x402 $0.025 when operator host reachable ([HOSTED.md](./docs/HOSTED.md)) |
| **Operator process** (`npm run deploy:host` / `dev`) | Keep OpenServ webhook online (maintainers only; containers can sleep/502 — see HOSTED.md) |
| **HTTP gate** (`npm run http:gate`) | Local/dev evaluate/execute (no OpenServ) |
| **WOW CLI** (`npm run wow`) | Theater: messy mandate → injection → gate → explain → AgentKit |
| **Vite UI** (`npm run ui`) | Demo story; `/api/copilot` → live SERV when key set |

## Runtime checklist

1. Never commit `.env` / `.openserv.json` / CDP secrets.
2. Never ask end users for `SERV_API_KEY`.
3. Policy allow/deny must go through `evaluateIntent` in `engine.ts`.
4. AgentKit signs only after ALLOW **and** a consumed allow-receipt (or escalate + humanApproved mint).
5. Clients are **fail-closed**: network/timeout/malformed → DENY (`assertSpend`). Trust `gate.isActive` only as a hint — still fail closed on hang/timeout.
6. Product name is **AllowLatch**.
7. Live proof (Base): agent USDC after receipt — e.g. [`0x3d9e46…`](https://basescan.org/tx/0x3d9e46e7f0a203dedd6f8845c94bb5d8d8764c5bdcf8a9450c08da0378c69c16); fee to operator — check `host-info` / `#case` on the site.

## Verify

```bash
npm run demo
npm run test
npm run wow
npm run battle
npm run typecheck
npm run ui:build
npm run mcp              # MCP stdio server
```
