# Monetization

## Product rule

**Enforcement is paid and remote.** Local demo JSON is not the product.

| Surface | Price | What you get |
|---------|-------|----------------|
| Demo UI draft / local gate | Free | Try SERV (host key) + see ALLOW/DENY in-browser. Not bound to your agent. |
| Demo JSON snapshot | Free, watermarked | `enforcement: "demo-only"` - **not** production. |
| **x402 call** (draft / apply / evaluate / explain / execute / buy_evaluate_pack) | **$0.025** | Hosted policy, SERV Copilot, deterministic gate, audit, allow-receipt. |
| **Evaluate pack** (prepaid credits after `buy_evaluate_pack`) | **Target: $1 / 100 evaluates** (~$0.01/check) | Call `buy_evaluate_pack` via the same x402 workflow; each later `evaluate_intent` with `packKey` burns 1 credit. Settlement is still OpenServ x402 to the **operator wallet** (`x402WalletAddress` / provision `WALLET_PRIVATE_KEY`). |

## Why agents pay

1. **Hosted policy** - change rules without shipping files to the agent.
2. **Central SQLite ledger** - daily + lifetime caps survive agent restarts; atomic under concurrency.
3. **Allow-receipt** - action digest + single-use `jti` (+ **required** `calldataHash` for swaps); agent must refuse to sign without verify.
4. **SERV Copilot** - draft/revise/explain on our key (injection-resistant tools).

Free local `engine.ts` + JSON is a **teaser**. Production path: discover AllowLatch Gate → pay → `evaluate_intent` / `execute_gated_transfer` before every spend.

## Pricing notes

- Flat **$0.025** per OpenServ x402 request is the default MVP meter (simple for judges + agents).
- Service name on the paywall / `discoverServices`: **AllowLatch Gate** (match `/allowlatch/i`).
- Evaluate pack: use `buy_evaluate_pack` then `evaluate_intent` with `packKey` to burn prepaid credits (avoids paying per micro-check once credits exist).
- Later: monthly unlimited evaluate for a fixed USDC subscription.

## Who receives payment

OpenServ x402 settles to the **AllowLatch operator** payout address configured on the x402 trigger (derived from the host `WALLET_PRIVATE_KEY` created by `provision()`, unless overridden). This is **not** the AgentKit/CDP spender wallet.

AllowLatch also writes SQLite audit events + optional `data/usage.jsonl` for operator analytics.

## Do not

- Market "download JSON and trade all night" as the product.
- Ship unrestricted production policy export from the free demo.
- Market this as a different product with a similar public name. Brand is **AllowLatch** only - demo: https://allowlatch.vercel.app
