# SpendGate monetization

## Product rule

**Enforcement is paid and remote.** Local demo JSON is not the product.

| Surface | Price | What you get |
|---------|-------|----------------|
| Demo UI draft / local gate | Free | Try SERV (host key) + see ALLOW/DENY in-browser. Not bound to your agent. |
| Demo JSON snapshot | Free, watermarked | `enforcement: "demo-only"` — **not** production. |
| **x402 call** (draft / apply / evaluate / explain / execute) | **$0.10** | Hosted policy, SERV Copilot, deterministic gate, usage log, allow-receipt. |

## Why agents pay

1. **Hosted policy** — change rules without shipping files to the agent.
2. **Central ledger** — daily caps survive agent restarts.
3. **Allow-receipt** — short-lived signed ALLOW; agent should refuse to sign without it.
4. **SERV Copilot** — draft/revise/explain on our key (injection-resistant tools).

Free local `engine.ts` + JSON is a **teaser**. Production path: discover SpendGate → pay $0.10 → `evaluate_intent` / `execute_gated_transfer` before every spend.

## Pricing

- Flat **$0.10 USD** per x402 request (OpenServ trigger).
- Covers SERV tokens (draft/explain) + margin on evaluate/execute.
- Later: split prices or monthly included-call packs.

## Payer identity

OpenServ x402 settlement identifies the paying wallet. SpendGate also appends a local usage line per capability (`data/usage.jsonl`) with capability name, policyId, and timestamp for operator analytics.

## Do not

- Market “download JSON and trade all night” as the product.
- Ship unrestricted production policy export from the free demo.
