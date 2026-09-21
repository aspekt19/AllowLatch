---
name: allowlatch
description: >-
  Enforce AllowLatch — spending turnstile for financial AI agents on Base/USDC.
  Works with any LLM agent. Primary path: always-on Vercel /api/gate with native
  $0.025 USDC x402. OpenServ is optional fallback only.
---

# AllowLatch

Universal agent skill (not Cursor-only).
https://allowlatch.vercel.app/llms.txt · https://allowlatch.vercel.app/agent.json

## Surfaces

1. **Primary (always-on)** — `POST https://allowlatch.vercel.app/api/gate`  
   Website Origin free to try. Agents pay **$0.025 USDC** x402 on Base.  
   Connect pack: `gateUrl` + `sessionSeal` + `walletPrivateKey`.
2. **OpenServ fallback** — discover `/allowlatch/i` · `$0.025` when host online.

## Before every spend

```ts
await assertSpend({
  policyId, gateUrl, sessionSeal,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  intent,
})
```

ALLOW + receipt → sign. DENY / timeout → stop. Never invent ALLOW.

## Install

- https://allowlatch.vercel.app/#install
- `npm i allowlatch`
- MCP: `npx allowlatch-mcp`
- This skill file

Docs: CONNECT · EMBED · MONETIZE · HOSTED (OpenServ ops only)
