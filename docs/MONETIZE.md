# Monetization

## Product rule

**Enforcement is paid and remote.** Local demo JSON is not the product.

| Surface | Price | What you get |
|---------|-------|----------------|
| Demo UI draft / local gate | Free | Try SERV (host key) + see ALLOW/DENY in-browser. Not bound to your agent. |
| Demo JSON snapshot | Free, watermarked | `enforcement: "demo-only"` — **not** production. |
| **x402 call** (draft / apply / evaluate / explain / execute) | **$0.10** | Hosted policy, SERV Copilot, deterministic gate, audit, allow-receipt. |
| **Evaluate pack** (same x402 workflow, prepaid credits) | **$1.00 / 25 evaluates** | Operator sets `ALLOWLATCH_PACK_CREDITS`; each `evaluate_intent` burns 1 credit after the pack purchase prompt. Cuts per-check cost to **$0.04**. |

## Why agents pay

1. **Hosted policy** — change rules without shipping files to the agent.
2. **Central SQLite ledger** — daily + lifetime caps survive agent restarts; atomic under concurrency.
3. **Allow-receipt** — action digest + optional `calldataHash` + single-use `jti`; agent must refuse to sign without verify.
4. **SERV Copilot** — draft/revise/explain on our key (injection-resistant tools).

Free local `engine.ts` + JSON is a **teaser**. Production path: discover AllowLatch → pay → `evaluate_intent` / `execute_gated_transfer` before every spend.

## Pricing notes

- Flat **$0.10** per OpenServ x402 request remains the default MVP meter (simple for judges + agents).
- For high-frequency micro-checks, use an **evaluate pack** ($1 / 25) so effective cost is ~$0.04 — see `ALLOWLATCH_PACK_CREDITS` / `buy_evaluate_pack` on the host.
- Later: monthly unlimited evaluate for a fixed USDC subscription.

## Payer identity

OpenServ x402 settlement identifies the paying wallet. AllowLatch also writes SQLite audit events + optional `data/usage.jsonl` for operator analytics.

## Do not

- Market “download JSON and trade all night” as the product.
- Ship unrestricted production policy export from the free demo.
- Confuse this project with commercial **spendgate.ai** (unrelated). Brand is **AllowLatch** only — demo: https://allowlatch.vercel.app
