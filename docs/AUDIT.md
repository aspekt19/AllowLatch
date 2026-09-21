# Pre-production audit checklist

AllowLatch has **not** completed a third-party security audit. Use this before putting meaningful balances behind the gate.

## Self-review (maintainers)

- [ ] Re-read [SECURITY.md](./SECURITY.md) threat model and production checklist end-to-end
- [ ] `npm test` green (engine + property + receipt + EIP-712 + store)
- [ ] Confirm clients use `assertSpend` / `createGatedAgentKit` / `allowLatchActionProvider` — no parallel raw signer
- [ ] Prefer `createGatedAgentKit({ gate: { kind: 'site' } })` over chat-only prompts; run `npm run bypass:negative`
- [ ] Production `/api/gate`: set `ALLOWLATCH_TURSO_DATABASE_URL` (+ auth token) so `GET /api/gate` reports `durable: true`
- [ ] `ALLOWLATCH_ENFORCEMENT=hybrid` + synced Spend Permission for live USDC
- [ ] Tenant: `ownerToken` and/or EIP-712 `ownerSig`; consider `ALLOWLATCH_REQUIRE_OWNER_SIG=1`
- [ ] Secrets rotated: `ALLOWLATCH_RECEIPT_SECRET`, `ALLOWLATCH_OPERATOR_TOKEN`, CDP
- [ ] Host keep-alive ([HOSTED.md](./HOSTED.md)); clients fail-closed on outage
- [ ] Hot wallet only; lifetime budget set; emergency stop tested

## External audit (recommended before scale)

Engage an auditor familiar with:

1. Deterministic policy engines and ledger race conditions (`jti` consume)
2. EIP-712 / receipt HMAC binding
3. x402 payment + multi-tenant hosts
4. Coinbase Spend Permissions / AgentKit signing paths

Scope should include `src/policy/engine.ts`, `src/billing/receipt.ts`, `src/auth/*`, `src/store/fs-store.ts`, `src/sdk/assert-spend.ts`, `src/executor/gated-executor.ts`.

Until then: treat middleware as **authorization**, not custody; keep balances small.
