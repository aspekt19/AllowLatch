# Monetization

## Product rule

**Enforcement is paid and remote.** Local demo JSON is not the product.

| Surface | Price | What you get |
|---------|-------|----------------|
| Demo UI draft / local gate | Free | Try SERV (host key) + see ALLOW/DENY in-browser. Not bound to your agent. |
| Demo JSON snapshot | Free, watermarked | `enforcement: "demo-only"` - **not** production. |
| **x402 call** (draft / apply / evaluate / explain / execute / buy_evaluate_pack) | **$0.025** | Hosted policy, SERV Copilot, deterministic gate, audit, allow-receipt. |
| **Evaluate pack** (prepaid credits after `buy_evaluate_pack`) | **Same $0.025 x402** → fixed credits (default **3**, ~$0.008/check) | Client cannot choose mint size. Burn with `packKey` on `evaluate_intent`. A separate $1/100 SKU needs multi-price triggers — not available yet. |

## Why agents pay

1. **Hosted policy** - change rules without shipping files to the agent; mutates require `ownerToken`.
2. **Central SQLite ledger** - daily + lifetime caps survive agent restarts; atomic under concurrency.
3. **Allow-receipt** - action digest + single-use `jti` (+ **required** `calldataHash` for swaps); agent must refuse to sign without verify.
4. **SERV Copilot** - draft/revise/explain on our key (injection-resistant tools).
5. **Fail-closed clients** - if the host is unreachable, `assertSpend` DENYs (never fail-open).

Free local `engine.ts` + JSON is a **teaser**. Production path: discover hosted **AllowLatch Gate** → pay → `evaluate_intent` / `execute_gated_transfer` before every spend. End users never run the host — see [HOSTED.md](./HOSTED.md).

## Evaluate pack (honest metering)

OpenServ x402 currently uses a **single** price (**$0.025**) for every capability call, including `buy_evaluate_pack`.

| Call | Credits minted | Effective |
|------|----------------|-----------|
| `buy_evaluate_pack` | **3** (override with `ALLOWLATCH_CREDITS_PER_X402`) | ~$0.008 / evaluate |
| Client-supplied `credits` | **ignored** | Prevents free mint inflation |

To accumulate more credits, call `buy_evaluate_pack` repeatedly (each call is a paid x402).

## Tenant auth (shared host)

Mutating policy / reading claimed policy / resetting day windows requires:

- `ownerId` on first `apply_policy` (mints `ownerToken` — **save it**)
- `ownerToken` on later mutates, or `ALLOWLATCH_OPERATOR_TOKEN`

`evaluate_intent` / `execute_gated_transfer` need only `policyId` (treat it as a capability secret; prefer unguessable ids). Spenders **cannot** rewrite limits without the owner token.

## Pricing notes

- Flat **$0.025** per OpenServ x402 request is the default MVP meter.
- Service name on the paywall / `discoverServices`: **AllowLatch Gate** (match `/allowlatch/i`).
- Evaluate pack: use `buy_evaluate_pack` then `evaluate_intent` with `packKey` to burn prepaid credits.
- Later: monthly unlimited evaluate for a fixed USDC subscription / multi-price SKUs when OpenServ supports them.

## Who receives payment

OpenServ x402 settles to the **AllowLatch operator** payout address configured on the x402 trigger (derived from the host `WALLET_PRIVATE_KEY` created by `provision()`, unless overridden). This is **not** the AgentKit/CDP spender wallet, and not necessarily the same key clients pass as `walletPrivateKey` into `assertSpend` (that key is only the **x402 payer**).

AllowLatch also writes SQLite audit events + optional `data/usage.jsonl` for operator analytics.

## Do not

- Market "download JSON and trade all night" as the product.
- Ship unrestricted production policy export from the free demo.
- Market a separate "$1 / 100" SKU until OpenServ multi-price triggers exist.
- Market this as a different product with a similar public name. Brand is **AllowLatch** only - demo: https://allowlatch.vercel.app
- Call middleware-only "custody-grade" or unqualified "non-custodial" when CDP keys live on the host execute path.