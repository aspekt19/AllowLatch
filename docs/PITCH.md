# AllowLatch — product pitch (shareable)

Short copy for posts, listings, and partner briefs. Live product: https://allowlatch.vercel.app  
No API keys for end users. Repo: https://github.com/aspekt19/AllowLatch

## One line

**SERV drafts the spending law. Deterministic code judges every spend. The agent signs on Base only after ALLOW + receipt — and agents pay $0.025 USDC x402 for the always-on gate.**

## What it is

AllowLatch is a **spending turnstile** for financial AI agents on **Base / USDC**:

1. **SERV Reasoning** (website `/api/copilot`) — draft / revise / explain natural-language mandates (Multipath · prompt_guard · shadow). Never allow/deny.
2. **Deterministic gate** (`engine.ts`) — ALLOW / DENY / ESCALATE from strict MandatePolicy.
3. **Always-on `/api/gate`** — browser free to try; agents pay **$0.025 USDC** native x402 on Base (Turso durable ledger when configured).
4. **`createGatedAgentKit({ kind: 'site' })`** — gate baked into signing so a raw AgentKit key cannot bypass the latch.

OpenServ discover/paywall is an **optional fallback**, not the primary path.

## Live proof (22 Sep 2026 · Base mainnet)

Full path on the site [`#case`](https://allowlatch.vercel.app/#case):

| Step | Proof |
|------|--------|
| SERV draft + explain | `/api/copilot` · model gpt-5.4-mini · Multipath / GUARD / shadow |
| Durable apply | policyId `serv-live-…` · `durable: true` |
| Paid DENY | fee [0x3e3e…](https://basescan.org/tx/0x3e3efd2d3814d32d85909e7e807519fa0fd99bd4f3b256e75b0b0c3392eca0c6) |
| Paid ESCALATE | fee [0x4a78…](https://basescan.org/tx/0x4a78280c108fe2769ebe1d98faa2770814a2fd4172896dc41e3f84e09a72c0f3) · not signed |
| Paid ALLOW → transfer | fee [0xa8ec…](https://basescan.org/tx/0xa8ecfda33d7b0f3ad00ed3935909aeb658289bc56f3cf17be3fba6b42233ae43) → [0x399d…](https://basescan.org/tx/0x399dd953a96332dfbb0e27dfc19dea0898c0a1a236f065216ef4e6759a2792b5) |

Operator fee wallet `0xa918…F677` rose with the three $0.025 settlements (**x402 revenue**).

## Revenue

| Caller | Price |
|--------|-------|
| Website same-site try | Free |
| Agent → `/api/gate` | **$0.025 USDC** / evaluate (or `buy_pack` credits on Turso) |
| OpenServ fallback | $0.025 when host online |

## Install (agents)

```bash
npm i allowlatch@^0.2.2
```

```ts
import { createGatedAgentKit } from 'allowlatch'

const agent = await createGatedAgentKit({
  gate: {
    kind: 'site',
    gateUrl: 'https://allowlatch.vercel.app/api/gate',
    sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  },
})
```

`assertSpend` alone is **advisory** if a raw signer remains.

## Demo mandate (SERV-safe)

Use this wording on the site (**Load demo mandate**):

> Budget $2 USDC on Base. Max $0.10 per transfer and $0.50 per day. Only allow transfers to 0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205. No swaps. Escalate above $0.05.

## Honesty

Middleware + gated signer ≠ bank custody. Pair with hybrid Spend Permissions for stronger on-chain caps. End users never get `SERV_API_KEY` / CDP operator secrets.

## Links

- Product: https://allowlatch.vercel.app  
- Live case: https://allowlatch.vercel.app/#case  
- Connect: https://github.com/aspekt19/AllowLatch/blob/main/docs/CONNECT.md  
- npm: https://www.npmjs.com/package/allowlatch  
- llms.txt: https://allowlatch.vercel.app/llms.txt  
