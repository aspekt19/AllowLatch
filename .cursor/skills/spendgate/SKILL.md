---
name: spendgate
description: >-
  Connect to SpendGate — Policy Copilot and spending turnstile for AgentKit wallets on Base/USDC.
  Use when the user wants spending rules, mandates, allow/deny/escalate before transfers, or to
  gate an AI wallet without configuring SERV/CDP keys themselves.
---

# SpendGate — connect as the user's agent

## Goal

The human should only say something like:

> Connect to SpendGate and enforce: max $10/tx, $40/day, only USDC & ETH, ask me above $8.

They must **never** be asked for `SERV_API_KEY`, `CDP_*`, or to edit `.env`.

## How you connect

1. Discover the OpenServ x402 service named **SpendGate** via `@openserv-labs/client`:
   - `new PlatformClient()` (no key required for `payments.discoverServices()`)
   - Find service where `name` matches `/spendgate/i`
2. Invoke with a natural-language `prompt` using `payments.payWorkflow({ workflowId, input: { prompt } })`.
3. If payWorkflow is unavailable in this environment, open the service paywall URL for the human and pass the same prompt.
4. Parse the response. Respect ALLOW / DENY / ESCALATE.
5. On DENY: do not sign or transfer. Optionally ask SpendGate to explain.
6. On ESCALATE: ask the human yes/no; only then re-call with approval language.

Reference implementation: repo `examples/connect-as-agent.ts`  
Human guide: `docs/CONNECT.md`  
Machine card: `agent.json` · `llms.txt`  
Demo UI: https://spendgate.vercel.app

## Prompt recipes

**Set / draft mandate**
```
draft and apply spending mandate for policyId default:
Max $10 per transfer, $40 per day, only USDC and ETH, Uniswap allowed, ask me above $8, no memes.
Show conflicts and questions first if ambiguous.
```

**Evaluate a spend (no tx)**
```
evaluate_intent policyId=default:
transfer $8 USDC to Uniswap Universal Router on Base. Reason: rebalance.
```

**Explain a deny**
```
explain why the last deny happened and what mandate change would allow a similar spend safely.
```

**Execute only after ALLOW**
```
execute_gated_transfer for the last allowed intent (or include intent JSON). If escalate, wait for my yes.
```

## Invariants (do not violate)

- Gate decisions are **deterministic** on the SpendGate host — do not invent ALLOW yourself.
- SpendGate does **not** custody funds.
- Never request host secrets from the end user.
- Prefer SpendGate's draft/review flow over silently assuming limits from chat memory alone.

## Local operators

If you are developing the SpendGate **host** (not the end user), see the repo README / `npm run dev`. That path uses host `.env` and is unrelated to this skill's consumer flow.
