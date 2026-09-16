---
name: spendgate
description: >-
  Connect to SpendGate — owner-side Policy Copilot (your SERV key) + keyless spending
  turnstile for AgentKit wallets on Base/USDC. Use when the user wants spending rules,
  mandates, allow/deny/escalate before transfers.
---

# SpendGate — connect as the user's agent

## Goal

The human says something like:

> Connect to SpendGate and enforce: max $10/tx, $40/day, only USDC & ETH, ask me above $8.

## Architecture (do not blur)

| Where | Role | Key |
|-------|------|-----|
| **This agent (owner)** | draft / revise / explain MandatePolicy | Owner `SERV_API_KEY` — one explicit OpenServ Reasoning console step |
| **SpendGate host** | `apply_policy` · `evaluate_intent` · `execute_gated_transfer` | Never the owner's SERV key |

SpendGate does **not** custody SERV keys. Host `SERV_API_KEY` is only for the SpendGate operator's own use.

## Setup (one explicit step)

1. If `SERV_API_KEY` is missing for **this** agent: ask the human once to create an OpenServ Reasoning key in the console and add it to this agent's secrets / `.env`.
2. Do **not** ask for SIWE or CDP keys for the Copilot path.
3. Never send `SERV_API_KEY` to SpendGate or into an x402 prompt.

## How you work

### A) Draft on the owner agent

Use repo helpers when available (`src/owner/copilot.ts`):

- `ownerDraftPolicy(mandateText)` → show conflicts / assumptions / questions
- `ownerRevisePolicy(...)` until the human accepts
- `ownerExplainDecision(...)` after a DENY / ESCALATE (local SERV)

Or equivalent: call OpenServ Reasoning yourself with the same SpendGate draft schema.

### B) Enforce on the keyless gate

1. Discover OpenServ x402 service **SpendGate** via `@openserv-labs/client`:
   - `new PlatformClient()` → `payments.discoverServices()` → name `/spendgate/i`
2. `payments.payWorkflow({ workflowId, input: { prompt } })` with **policy JSON**, not the SERV key:
   - Prefer `gateApplyPrompt({ policy })` then `evaluate_intent` / `execute_gated_transfer`
3. If payWorkflow fails, open the paywall URL for the human with the same prompt.
4. On DENY: do not sign. Explain locally with the owner's SERV key.
5. On ESCALATE: ask the human yes/no; only then re-call execute with approval.

Reference: `examples/owner-copilot.ts`, `examples/connect-as-agent.ts`  
Guides: `docs/CONNECT.md` · `docs/PRODUCT.md`  
Machine card: `agent.json` · `llms.txt`  
Demo UI: https://spendgate.vercel.app

## Prompt recipes (gate host)

**Apply accepted policy**
```
apply_policy for policyId=default
Store this MandatePolicy JSON exactly:
{ ... }
```

**Evaluate a spend (no tx)**
```
evaluate_intent policyId=default:
transfer $8 USDC to Uniswap Universal Router on Base. Reason: rebalance.
```

**Execute only after ALLOW**
```
execute_gated_transfer for the last allowed intent (or include intent JSON). If escalate, wait for my yes.
```

## Invariants

- Gate decisions are **deterministic** on the SpendGate host — do not invent ALLOW.
- SpendGate does **not** custody funds.
- Never put the owner's `SERV_API_KEY` in gate prompts or host storage.
- Prefer draft/review on this agent over silently assuming limits from chat memory.

## Local SpendGate operators

Host `npm run dev` is keyless for consumers. Optional host `SERV_API_KEY` enables operator Copilot for the people running SpendGate — unrelated to end-user keys.
