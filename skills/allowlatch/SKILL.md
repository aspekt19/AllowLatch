---
name: allowlatch
description: >-
  Enforce AllowLatch — spending turnstile for financial AI agents on Base/USDC
  (AgentKit and similar). Works with any LLM agent (Cursor, Claude, Codex, OpenServ,
  custom). Production agents use hosted OpenServ Gate ($0.025 x402). Website /api/gate
  is always-on for humans to try; do not treat local JSON as enforcement.
---

# AllowLatch

Universal agent skill (not Cursor-only). Also read:
https://allowlatch.vercel.app/llms.txt · https://allowlatch.vercel.app/agent.json

## Surfaces

1. **Website gate (preferred, always-on)** — https://allowlatch.vercel.app  
   Draft → Go live → Connect pack (`gateUrl` + `sessionSeal`) → `assertSpend`.  
2. **OpenServ x402 (paid, when host online)** — discover `/allowlatch/i` · **$0.025**.  
   Check host-info; timeout → **DENY**. `isActive` alone is insufficient.

## Connect (agents)

1. Prefer Connect pack from the site: `assertSpend({ gateUrl, sessionSeal, policyId, intent })`.
2. Or OpenServ: discover `/allowlatch/i` → x402 when host online.
3. Before **every** transfer / swap / x402 pay: `assertSpend` or `evaluate_intent`.
4. ALLOW + single-use **allow-receipt** (`jti`) → then sign / `execute_gated_transfer`.
5. Prefer `createGatedAgentKit` so raw AgentKit cannot bypass the latch.

## Install

- Site Connect pack: https://allowlatch.vercel.app/#install
- `npm i allowlatch` → `assertSpend` / `createGatedAgentKit`
- MCP: `npx allowlatch-mcp`
- This skill file (any agent store / system prompt)
- Live case: https://allowlatch.vercel.app/#case

## Live case

Base mainnet: paid assertSpend → receipt → transfer  
https://basescan.org/tx/0x3d9e46e7f0a203dedd6f8845c94bb5d8d8764c5bdcf8a9450c08da0378c69c16

## Invariants

- Decisions are deterministic on the host — never invent ALLOW
- No applied policy → refuse all spends
- Never ask the user for `SERV_API_KEY` / CDP secrets or to run `npm run dev`
- Website free `/api/gate` ≠ substitute for paid OpenServ enforcement on trading agents

Docs: https://github.com/aspekt19/AllowLatch/blob/main/docs/CONNECT.md  
Embed: https://github.com/aspekt19/AllowLatch/blob/main/docs/EMBED.md  
Hosted ops: https://github.com/aspekt19/AllowLatch/blob/main/docs/HOSTED.md
