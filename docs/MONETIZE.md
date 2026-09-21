# Monetization

## Product rule

**Enforcement is paid and remote** for agents. Local demo JSON is not the product.  
The **always-on** meter is native **x402 on Vercel** `/api/gate` (Base USDC). OpenServ x402 is an **optional fallback**.

| Surface | Price | What you get |
|---------|-------|----------------|
| Website UI (same-site browser) | Free | Draft / Go live / try ALLOW·DENY·ESCALATE + receipts |
| **Agent → `/api/gate`** | **$0.025 USDC** x402 on Base | Always-on evaluate + allow-receipt (Origin spoof alone is not free) |
| OpenServ discover / paywall | **$0.025** x402 | Fallback when site gate fails or `preferOpenServ` |
| Demo JSON snapshot | Free, watermarked | `enforcement: "demo-only"` — **not** production |

## Why agents pay

1. **Hosted policy** — change rules without shipping files; mutates require `ownerToken` (browser-side), not the agent Connect pack.
2. **Ledger + receipts** — daily caps + single-use `jti` (SQLite host is durable; Vercel site gate is session-scoped — see [SECURITY.md](./SECURITY.md)).
3. **SERV Copilot** on the operator key (draft/explain).
4. **Fail-closed clients** — unreachable gate → DENY.

## Who receives payment

Site-gate x402 settles to `ALLOWLATCH_X402_PAY_TO` or the address of `WALLET_PRIVATE_KEY` (operator).  
OpenServ x402 (fallback) settles to the OpenServ trigger payout wallet.

## Env (Vercel)

- `ALLOWLATCH_RECEIPT_SECRET` — **preferred** dedicated secret for receipts + sessionSeal (avoid reusing `SERV_API_KEY`)
- `SERV_API_KEY` — Copilot only; temporary receipt fallback warns in production
- `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` — Coinbase x402 facilitator (verify/settle)
- `WALLET_PRIVATE_KEY` or `ALLOWLATCH_X402_PAY_TO` — payee on Base
- `ALLOWLATCH_TURSO_DATABASE_URL` + `ALLOWLATCH_TURSO_AUTH_TOKEN` — **durable** shared ledger for `/api/gate` (recommended for anything beyond demo)
- Optional: `ALLOWLATCH_SITE_GATE_X402=0` — disable paywall (dev only)

## Do not

- Market “download JSON and trade all night” as the product.
- Treat OpenServ `isActive` as proof the paid path works without a successful `payWorkflow`.
- Call middleware-only “custody-grade” when CDP keys live on an execute path.

See [CONNECT.md](./CONNECT.md) · [HOSTED.md](./HOSTED.md) · [EMBED.md](./EMBED.md).
