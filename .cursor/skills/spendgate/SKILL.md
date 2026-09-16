---
name: spendgate
description: >-
  Connect to SpendGate — Policy Copilot (SERV Reasoning) + spending turnstile for
  AgentKit wallets on Base/USDC. Use when the user wants spending rules, mandates,
  allow/deny/escalate before transfers — without configuring SERV/CDP themselves.
---

# SpendGate — connect as the user's agent

## Goal

The human says:

> Connect to SpendGate and enforce: max $10/tx, $40/day, only USDC & ETH, ask me above $8.

They must **never** be asked for `SERV_API_KEY`, `CDP_*`, or to edit `.env`.

## How you connect

1. Discover OpenServ x402 service **SpendGate** via `@openserv-labs/client`:
   - `new PlatformClient()` → `payments.discoverServices()` → name `/spendgate/i`
2. Invoke with NL `prompt` via `payments.payWorkflow({ workflowId, input: { prompt } })`.
3. If payWorkflow fails, open the paywall URL for the human.
4. Respect ALLOW / DENY / ESCALATE. On DENY: do not sign; ask SpendGate to explain. On ESCALATE: ask the human.

Reference: `examples/connect-as-agent.ts` · `docs/CONNECT.md`  
Theater demo: `npm run wow`  
Demo UI: https://spendgate.vercel.app

## Prompt recipes

**Set / draft mandate**
```
draft and apply spending mandate for policyId default:
Max $10 per transfer, $40 per day, only USDC and ETH, Uniswap allowed, ask me above $8, no memes.
Show conflicts and questions first if ambiguous.
```

**Evaluate**
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
execute_gated_transfer for the last allowed intent. If escalate, wait for my yes.
```

## Invariants

- Gate decisions are **deterministic** on the SpendGate host — do not invent ALLOW.
- SERV on the host drafts/explains; it never overrides the gate verdict.
- SpendGate does not custody funds.
- Never request host secrets from the end user.

## Operators

Host `npm run dev` / `npm run wow` uses host `.env` (`SERV_API_KEY`, optional CDP). Unrelated to this skill’s consumer flow.
