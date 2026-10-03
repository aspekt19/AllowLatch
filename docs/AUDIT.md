# Pre-production audit checklist

AllowLatch has **not** completed a third-party security audit. Use this before putting meaningful balances behind the gate.

## Self-review (maintainers)

- [ ] Re-read [SECURITY.md](./SECURITY.md) threat model and production checklist end-to-end
- [ ] `npm test` green (engine + property + receipt + EIP-712 + store)
- [ ] **Required:** clients use `createGatedAgentKit({ kind: 'site' })` — no parallel raw signer (`assertSpend` / action provider are advisory helpers only)
- [ ] Run `npm run bypass:negative` against the gated path
- [ ] Production `/api/gate`: set `ALLOWLATCH_TURSO_DATABASE_URL` (+ auth token) so `GET /api/gate` reports `durable: true`
- [ ] `ALLOWLATCH_ENFORCEMENT=hybrid` + synced Spend Permission for live USDC (primary: agent `hybrid_plan` via Copy for my AI; operator `sync_wallet` optional; treasury on owner SA; never put funded private key in the agent)
- [ ] Tenant: `ownerToken` and/or EIP-712 `ownerSig`; consider `ALLOWLATCH_REQUIRE_OWNER_SIG=1`
- [ ] **`ALLOWLATCH_RECEIPT_SECRET` required in production** (no `SERV_API_KEY` fallback); rotate with CDP / operator tokens
- [ ] Host keep-alive ([HOSTED.md](./HOSTED.md)); clients fail-closed on outage
- [ ] Hot wallet only; lifetime budget set; emergency stop tested; swaps off unless calldata adapter exists
- [ ] Durable evaluate requires latest `sessionSeal` (policyId alone is not a spender credential)

## External audit (recommended before scale)

Engage an auditor familiar with:

1. Deterministic policy engines and ledger race conditions (`jti` consume)
2. EIP-712 / receipt HMAC binding
3. x402 payment + multi-tenant hosts
4. Coinbase Spend Permissions / AgentKit signing paths

Scope should include `src/policy/engine.ts`, `src/billing/receipt.ts`, `src/auth/*`, `src/store/fs-store.ts`, `src/sdk/assert-spend.ts`, `src/executor/gated-executor.ts`.

Until then: treat middleware as **authorization**, not custody; keep balances small. A funded private key in the agent defeats gate + Spend Permissions.
