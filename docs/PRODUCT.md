# SpendGate — Product

**SpendGate** is a control layer for financial AI agents with a wallet (Coinbase AgentKit / Base / USDC).

It is **not** a bank, not a custodian, and not an LLM that decides whether money may move.

It is a **Policy Copilot + hard turnstile**:

1. The owner states and revises spending rules in natural language.
2. SERV Reasoning helps draft the policy, surface conflicts, and explain denials.
3. Before every spend, **deterministic code** returns allow / deny / escalate.
4. AgentKit moves funds **only after ALLOW** (or escalate + explicit human approval).

Live demo: https://spendgate.vercel.app  
Repo: https://github.com/aspekt19/SpendGate

---

## Problem

An agent with a funded Base wallet can drain itself through loops, bad destinations, over-eager swaps, or prompt injection. A chat instruction (“don’t spend more than $10”) is not a control.

AgentKit itself does not enforce spend caps, destination allowlists, or human approval on transfers. Something must sit **in front of signing**.

---

## Goal

Give the owner of a financial agent a way to say **how money may be spent**, keep those rules maintainable in plain language, and ensure the agent cannot bypass them via prompting or mistakes.

---

## Who it is for

| Who | Why |
|-----|-----|
| Builders on Base / AgentKit | Stop a bot from draining test or live USDC |
| Operators of paying / x402 agents | Limits, addresses, escalation without re-coding every time |
| Owners of “agent + wallet” setups | Mandate in words → policy → auditable decisions |

Out of scope: retail banking UX, and “any rules for any agents” outside finance.

---

## How it works

```
Owner
  → describes / revises mandate (NL)
SpendGate Copilot (SERV Reasoning)
  → draft policy, conflicts, assumptions, clarifying questions
  → apply → MandatePolicy (JSON)
Financial agent (Spender)
  → before spend: evaluate / execute_gated_transfer
SpendGate Gate (code, no LLM)
  → ALLOW | DENY | ESCALATE
AgentKit / CDP
  → sign Base USDC only on ALLOW (+ humanApproved on escalate)
```

| Layer | Tech | Role |
|-------|------|------|
| Copilot | SERV Reasoning | Understand mandate, conflicts, explain, revise |
| Gate | `src/policy/engine.ts` | Caps, symbols, addresses, velocity, escalate |
| Execute | AgentKit / CDP | Transaction only after green light |

SpendGate does **not** hold user funds. Keys stay with CDP / the owner.

**Target UX:** skills / capabilities on the user’s existing agent — not a mandatory second chat. The dialog UI is a demo surface.

---

## Policy surface (v1)

- Wallet budget / max per order / daily notional / txs per hour  
- Allow / deny symbols and addresses  
- Actions: transfer / swap / x402_pay  
- Human-confirm threshold (escalate)  
- Spend ledger (day / hour)

Chain focus: **Base**. Policy currency: **USDC**.

---

## What we are not

- Not a replacement for Coinbase / CDP wallets  
- Not an on-chain spend vault (possible later; not v1)  
- Not an LLM allow/deny judge  
- Not a universal policy OS for non-financial domains  

---

## One-line pitch

> For a financial agent on Base: state rules in words → SpendGate drafts and explains the policy → without ALLOW, AgentKit does not move money.

---

## Build direction

| Layer | Status |
|-------|--------|
| Deterministic gate | Done (`engine.ts`) |
| SERV draft / revise / compile | Done |
| `explain_decision` | Done |
| Agent capabilities (skill surface) | Done |
| Demo UI Policy Copilot review | Done (offline draft; production uses SERV) |
| Live CDP battle | Optional — see [BATTLE.md](./BATTLE.md) |

Verify:

```bash
npm run reasoning:copilot   # draft → revise → apply → gate → explain
npm run battle              # Spender → gate → AgentKit dry-run
npm run ui                  # review flow in the browser
```
