---
name: allowlatch
description: >-
  Enforce AllowLatch - spending turnstile for financial AI agents on Base/USDC
  (AgentKit and similar). Production agents use hosted OpenServ Gate ($0.025 x402).
  Website /api/gate is for humans to try; do not treat local JSON as enforcement.
---

# AllowLatch

## Surfaces

1. **Website (always-on)** — https://allowlatch.vercel.app  
   Human: Draft → Go live → try spends via `/api/gate` (free). Then **Connect your agent**.
2. **Agent gate (paid)** — OpenServ **AllowLatch Gate** (`/allowlatch/i`) · **$0.025** x402.  
   Check `GET https://allowlatch.vercel.app/api/host-info` → `gate.isActive`.  
   On timeout / error → **DENY** (fail-closed). Never invent ALLOW.

## Connect (agents)

1. Discover: `PlatformClient.payments.discoverServices()` → `/allowlatch/i`  
   or URLs from https://allowlatch.vercel.app/api/host-info
2. Apply MandatePolicy once (`apply_policy` / paywall / site Go live + Connect pack).
3. Before **every** transfer / swap / x402 pay: `assertSpend` or `evaluate_intent`.
4. ALLOW + single-use **allow-receipt** (`jti`) → then sign / `execute_gated_transfer`.
5. Prefer `createGatedAgentKit` so raw AgentKit cannot bypass the latch.

## Install

- Site Connect pack: https://allowlatch.vercel.app/#install
- `npm i allowlatch` → `assertSpend` / `createGatedAgentKit`
- MCP: `npx allowlatch-mcp`
- Live case: https://allowlatch.vercel.app/#case

## Invariants

- Decisions are deterministic on the host — never invent ALLOW
- No applied policy → refuse all spends
- Never ask the user for `SERV_API_KEY` / CDP secrets or to run `npm run dev`
- Website free `/api/gate` ≠ substitute for paid OpenServ enforcement on trading agents
- `gate.isActive` alone is insufficient — timeout → DENY.
## Live case

Base mainnet: paid assertSpend → receipt → transfer  
https://basescan.org/tx/0x3d9e46e7f0a203dedd6f8845c94bb5d8d8764c5bdcf8a9450c08da0378c69c16



Docs: https://github.com/aspekt19/AllowLatch/blob/main/docs/CONNECT.md  
Embed: https://github.com/aspekt19/AllowLatch/blob/main/docs/EMBED.md  
Hosted ops: https://github.com/aspekt19/AllowLatch/blob/main/docs/HOSTED.md
