# SpendGate — Product

**SpendGate** is a control layer for financial AI agents with a wallet (Coinbase AgentKit / Base / USDC).

It is **not** a bank, not a custodian, and not an LLM that decides whether money may move.

It is a **Policy Copilot + hard turnstile**:

1. The owner states and revises spending rules in natural language.
2. **Owner-side** SERV Reasoning drafts the policy, surfaces conflicts, and explains denials (owner’s Reasoning key — one console step; no SIWE yet).
3. **SpendGate host** stores MandatePolicy JSON and, before every spend, **deterministic code** returns allow / deny / escalate. Host never stores end-user SERV keys.
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
Owner agent + SERV (owner’s key)
  → draft policy, conflicts, assumptions, clarifying questions
  → accepted MandatePolicy JSON
SpendGate host (keyless gate)
  → apply_policy → store JSON
Financial agent (Spender)
  → before spend: evaluate / execute_gated_transfer (x402)
SpendGate Gate (code, no LLM)
  → ALLOW | DENY | ESCALATE
AgentKit / CDP (host, if live)
  → sign Base USDC only on ALLOW (+ humanApproved on escalate)
```

| Layer | Tech | Role |
|-------|------|------|
| Copilot | SERV on **owner agent** | Mandate, conflicts, explain, revise |
| Gate | `src/policy/engine.ts` on host | Caps, symbols, addresses, velocity, escalate |
| Execute | AgentKit / CDP on host | Transaction only after green light |

SpendGate does **not** hold user funds or end-user Reasoning keys. Host `SERV_API_KEY` is only for our operator/dev Copilot.

**Target UX:** skills on the user’s existing agent — one explicit Reasoning key step; not SIWE yet. The dialog UI is a demo surface.

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

> For a financial agent on Base: state rules in words → your agent drafts with your Reasoning key → SpendGate’s gate enforces them → without ALLOW, AgentKit does not move money.

---

## Build direction

| Layer | Status |
|-------|--------|
| Deterministic gate | Done (`engine.ts`) |
| Owner-side SERV draft / revise / explain | Done (`src/owner/copilot.ts`) |
| Keyless host gate | Done (`apply_policy` / evaluate / execute) |
| Operator host Copilot (optional SERV) | Done — self/dev only |
| Demo UI Policy Copilot review | Done (offline draft) |
| Live CDP battle | Optional — see [BATTLE.md](./BATTLE.md) |

Verify:

```bash
npm run owner:copilot       # owner SERV draft → gate apply prompt
npm run reasoning:copilot   # operator cycle when host SERV_API_KEY set
npm run battle              # Spender → gate → AgentKit dry-run
npm run ui                  # review flow in the browser
```
