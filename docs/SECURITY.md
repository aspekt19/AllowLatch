# Security model

AllowLatch is a **fail-closed spending turnstile**. Ambiguity, timeouts, malformed responses, and invalid receipts must never become `ALLOW`.

This document is the public threat model and production checklist. For architecture surfaces see [ARCHITECTURE.md](./ARCHITECTURE.md). For wallet-native caps see [WALLET_NATIVE.md](./WALLET_NATIVE.md).

## Trust boundaries

| Layer | Trust |
|-------|--------|
| Owner mandate (NL) | Untrusted until applied; show draft + confirm before `apply_policy` |
| SERV Copilot | Drafts / explains only — **never** overrides `engine.ts` |
| Deterministic gate (`evaluateIntent`) | Source of truth for allow / deny / escalate |
| Allow-receipt (`jti` + HMAC) | Single-use capability token bound to action digest |
| Agent / Spender | **Untrusted** — must not be able to sign without a consumed receipt |
| Remote x402 / HTTP gate | Fail-closed client (`assertSpend`); treat network errors as DENY |
| Shared host tenants | `ownerToken` (minted on first apply) or `ALLOWLATCH_OPERATOR_TOKEN` for mutate/read |

## Multi-tenant rules

1. **Create** policy → require `ownerId`; host returns one-time `ownerToken` (store client-side).
2. **Update** policy / sync wallet / read claimed policy / reset day ledger → require `ownerToken` or operator.
3. **Evaluate / execute** → `policyId` only (spender path). Prefer unguessable `policyId`s.
4. **Lifetime budget** never resets via public tools. `reset_daily_ledger` clears day/hour only.
5. **Pack credits** — client cannot choose mint size; each paid `buy_evaluate_pack` grants a fixed credit amount.

## Fail-closed rules

1. **Transport failure** (timeout, DNS, 5xx, payment error) → treat as DENY; never proceed to sign.
2. **Malformed JSON / unknown `decision`** → DENY.
3. **ALLOW without receipt** → DENY.
4. **Receipt verify fails** (sig, expiry, policyHash, intentHash, chain, calldataHash) → DENY.
5. **`jti` already consumed** → DENY (replay).
6. **Escalate** without explicit `humanApproved` → do not mint/consume a receipt for auto-execute.
7. **Host / SQLite unavailable** → client DENY (`assertSpend`); never fail-open to a local bypass for live funds.

`src/sdk/assert-spend.ts` throws `AllowLatch DENY (fail-closed): …` on (1)–(4).

## Owner auth (policy mutate)

| Path | When |
|------|------|
| `ownerToken` | Minted on first `apply_policy` — required for later mutates |
| EIP-712 `ownerSig` | Optional stronger path: sign `MandatePolicyApply { policyId, policyHash, ownerId }` (see `src/auth/policy-eip712.ts`). Can replace token on update once `ownerAddress` is bound. |
| `ALLOWLATCH_OPERATOR_TOKEN` | Operator bypass |
| `ALLOWLATCH_REQUIRE_OWNER_SIG=1` | Require EIP-712 on every mutate |

Spenders with only `policyId` can evaluate/execute — they **cannot** rewrite limits without owner token or valid owner sig.

## What the receipt binds

Canonical action digest (`hashAction`) includes:

- `action`, `amountUsd`, `symbol`
- `tokenAddress`, `toAddress`, `contractAddress`, `spenderAddress`
- `chainId`, `networkId`
- `functionSelector`, `calldataHash`, `slippageBps`

Free-text `reason` / `requestId` are **not** in the digest (narrative must not change authorization).

Receipt also carries `chain` (policy chain at issue) and optional `calldataHash` echo. Swaps **require** `calldataHash` at evaluate time.

## Token & chain binding

- Policy `chain` is `base` | `base-sepolia` (ids 8453 / 84532).
- Intent `chainId` / `networkId`, when present, must match policy.
- Prefer `universe.allowedTokenAddresses` over symbols alone.
- If `symbol === USDC` and `tokenAddress` is set, it must be the canonical USDC for that chain.

## Enforcement placement (critical)

**Do not** let the agent choose between `assertSpend` and raw `wallet.sendTransaction`.

Preferred shapes:

```text
Agent intent → gated wallet adapter / createGatedAgentKit → evaluate → receipt → signer → broadcast
```

Weak shape (bypassable):

```text
Agent ──┬── assertSpend(...)
        └── wallet.sendTransaction(...)   ← avoid
```

Use `createGatedAgentKit`, host `execute_gated_transfer`, or an RPC/signer wrapper that cannot be skipped. Default `ALLOWLATCH_ENFORCEMENT` is **hybrid** so on-chain Spend Permissions mirror daily USDC caps when `ALLOWLATCH_SMART_ACCOUNT` is set — even if middleware is bypassed.

## Vercel site gate (`/api/gate`) — honest limits

| Property | Behavior |
|----------|----------|
| **Durable mode** | Set `ALLOWLATCH_TURSO_DATABASE_URL` (+ `ALLOWLATCH_TURSO_AUTH_TOKEN`). Shared ledger + unique `jti` across isolates. Seal is **v3 reference** (no ledger in client). `POST action=consume` settles a receipt after use. |
| **Demo mode** (no Turso) | `sessionSeal` (HMAC) + in-memory `Map` — survives cold starts only if the client returns the latest seal. **Not** multi-instance safe. |
| `ownerToken` | Returned on apply to the **browser**; **not** embedded in `sessionSeal` (v2/v3). Never paste `ownerToken` into agent Connect packs |
| Freshness (demo) | Monotonic `seq` rejects rolling the ledger back when this process already has a newer seal |
| Multi-instance races | **Fixed in durable mode.** In demo mode two concurrent evaluates on different isolates can both ALLOW against the same old seal |
| Free website calls | Same-site browser `Sec-Fetch-*` + allowlisted Origin — **UX convenience**, not a cryptographic paywall. Agents without those signals pay x402 |
| Receipt secret | Prefer dedicated `ALLOWLATCH_RECEIPT_SECRET`. Falling back to `SERV_API_KEY` is supported for ops continuity but is poor secret hygiene |
| Budget vs settlement | On ALLOW the daily/lifetime ledger is reserved when the receipt is issued (conservative). Durable `consume` marks `jti` settled for replay protection at the execute boundary |

Prefer durable Turso for any balance you care about. Treat demo mode as **always-on smoke path** with small balances. SQLite operator host (`npm run http:gate`) remains the local atomic alternative.

Escalate + `humanApproved` on HTTP `/v1/execute` requires `ownerToken` (or operator) — the spender cannot self-approve.

Public bypass teaching case: `npx tsx examples/bypass-negative.ts`

## Threat model (summary)

| Threat | Mitigation |
|--------|------------|
| Wrong recipient | Address allow/deny lists; require `toAddress` when allowlist non-empty |
| Over spend / loops | Per-order, daily, lifetime, hourly velocity, optional gas day cap (UTC ledger) |
| Receipt replay | Single-use `jti` in SQLite; consume at execute |
| Prompt injection into mandate | SERV multipath / prompt_guard / shadow; human confirm draft before apply |
| Fake USDC / ticker spoof | `tokenAddress` + canonical USDC check; token allowlists |
| Wrong chain | `chainId` / `networkId` vs policy.chain; receipt `chain` field |
| Mutated swap calldata | Required `calldataHash`; receipt echo; verify before external submit |
| Gate outage | Fail-closed client; no fail-open local bypass for live funds |
| Forged `apply_policy` | `ownerToken` and/or EIP-712 `ownerSig` over `policyHash`; optional `ALLOWLATCH_REQUIRE_OWNER_SIG` |
| Spoofed free Origin | Free path also checks browser `Sec-Fetch-Site`; agents still 402 without payment |
| Stale `sessionSeal` replay | Monotonic `seq` on site gate (same isolate); durable store still required for multi-instance |
| API abuse | HTTP Bearer off-loopback; CORS + rate limits on demo `/api/copilot` |

Honest limitation: **middleware-only** mode is not custody-grade if the spender retains an ungated private key. Pair with hybrid Spend Permissions and a low-balance hot wallet.

## Production checklist

Before putting meaningful balance behind AllowLatch:

1. [ ] Signer path cannot call AgentKit/CDP transfer without `assertSpend` / gated adapter / host execute.
2. [ ] Client treats timeout / 5xx / bad JSON as DENY (verify `assertSpend`).
3. [ ] Parallel evaluate+execute cannot double-spend the same `jti`.
4. [ ] Receipt binds chain, recipient, amount, asset/token, and (for swaps) calldata hash.
5. [ ] Daily ledger rolls on UTC day boundaries; lifetime never resets via public APIs (`reset_daily_ledger` only).
6. [ ] Policy apply requires `ownerId` + returned `ownerToken` (or operator token); no silent cross-tenant mutate.
7. [ ] Token rules use contract addresses where possible; USDC matches canonical Base contract.
8. [ ] Adversarial swap/approve calldata tested (selector + calldataHash).
9. [ ] Audit log correlates intent → decision → receipt `jti` → tx hash (scoped by policyId + ownerToken).
10. [ ] `risk.emergencyStop` (or equivalent kill switch) tested.
11. [ ] Separate hot wallet with minimal USDC; rotate `ALLOWLATCH_RECEIPT_SECRET` / CDP / `ALLOWLATCH_OPERATOR_TOKEN`.
12. [ ] Prefer / keep `hybrid` enforcement + synced Spend Permission for live execute (default mode).
13. [ ] Prefer EIP-712 `ownerSig` on apply (or keep `ownerToken` secret); enable `ALLOWLATCH_REQUIRE_OWNER_SIG` for high-value tenants.
14. [ ] `buy_evaluate_pack` ignores client credit amounts; credits bound to paid x402 calls.

## Reporting

Security issues: open a private report via GitHub Security Advisories on [aspekt19/AllowLatch](https://github.com/aspekt19/AllowLatch), or contact the maintainer listed on the repo.
