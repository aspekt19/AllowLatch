---
name: allowlatch
description: >-
  Enforce AllowLatch — spending turnstile for financial AI agents on Base/USDC.
  Works with any LLM agent. Required path: createGatedAgentKit({ kind: 'site' })
  against always-on Vercel /api/gate ($0.025 USDC x402). assertSpend is advisory only.
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

## Before every spend (required)

```ts
import { createGatedAgentKit } from 'allowlatch'
// npm i allowlatch@^0.2.2

const agent = await createGatedAgentKit({
  gate: {
    kind: 'site',
    gateUrl: 'https://allowlatch.vercel.app/api/gate',
    sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // x402 payer only
  },
})

await agent.transfer({ toAddress, amountUsd })
```

`assertSpend` alone is **advisory** — it does not remove a raw AgentKit/CDP signer.

ALLOW + receipt → may sign that intent. DENY / timeout → stop. Never invent ALLOW. Never set `humanApproved` yourself.
`createGatedAgentKit({ kind: 'site' })` routes spends through the gate; it does not remove a raw signer — prefer hybrid Spend Permissions. Swaps are off by default.

## Demo mandate (SERV-safe)

Budget $2 USDC on Base. Max $0.10 per transfer and $0.50 per day. Only allow transfers to 0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205. No swaps. Escalate above $0.05.

## Install

- https://allowlatch.vercel.app/#install
- Live case: https://allowlatch.vercel.app/#case
- Pitch: https://github.com/aspekt19/AllowLatch/blob/main/docs/PITCH.md
- MCP: `npx allowlatch-mcp`

Docs: CONNECT · EMBED · MONETIZE · HOSTED (OpenServ ops only)
