---
name: allowlatch
description: >-
  Enforce AllowLatch — spending turnstile for financial AI agents on Base/USDC.
  Works with any LLM agent. Primary path: always-on Vercel /api/gate with native
  $0.025 USDC x402. SERV drafts/explains on the website; OpenServ is optional fallback.
---

# AllowLatch

Universal agent skill (not Cursor-only).
https://allowlatch.vercel.app/llms.txt · https://allowlatch.vercel.app/agent.json

## Surfaces

1. **Primary (always-on)** — `POST https://allowlatch.vercel.app/api/gate`  
   Website browser (same-site) free to try. Agents pay **$0.025 USDC** x402 on Base.  
   Connect pack: `gateUrl` + `sessionSeal` + x402 `walletPrivateKey` (never `ownerToken` / `SERV_API_KEY`).
2. **SERV Copilot (owners)** — Draft / revise / explain on the site via `/api/copilot`. Does **not** decide allow/deny.
3. **OpenServ fallback** — discover `/allowlatch/i` · `$0.025` when host online.

## Before every spend

Prefer `createGatedAgentKit` with `kind: 'site'` so the signer cannot bypass the latch.

```ts
await createGatedAgentKit({
  gate: {
    kind: 'site',
    gateUrl: 'https://allowlatch.vercel.app/api/gate',
    sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
  },
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // x402 payer only
})

// or assert-only:
await assertSpend({
  policyId, gateUrl, sessionSeal,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  intent, // include tokenAmount for USDC transfers
})
```

ALLOW + receipt → sign. DENY / timeout → stop. Never invent ALLOW. Never set `humanApproved` yourself.

## Install

- https://allowlatch.vercel.app/#install
- Live case (SERV + paid Base): https://allowlatch.vercel.app/#case
- `npm i allowlatch`
- MCP: `npx allowlatch-mcp`
- This skill file

Docs: CONNECT · EMBED · MONETIZE · HOSTED (OpenServ ops only)
