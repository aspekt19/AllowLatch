# AllowLatch — Product

**AllowLatch** is a control layer for financial AI agents with a wallet (Coinbase AgentKit / Base / USDC).

It is **not** a bank, not a custodian, and not an LLM that decides whether money may move.

It is a **Policy Copilot + hard turnstile**:

1. The owner states and revises spending rules in natural language.
2. **SERV Reasoning on the AllowLatch host** drafts the policy, surfaces conflicts, resists prompt injection, and explains denials (Multipath · prompt_guard · shadow).
3. Before every spend, **deterministic code** returns allow / deny / escalate — the LLM never overrides the verdict.
4. AgentKit moves funds **only after ALLOW** (or escalate + explicit human approval).

End users need **no API keys**. Agents connect via OpenServ x402; the host holds SERV (+ optional CDP).

Live demo: https://allowlatch.vercel.app  
Repo: https://github.com/aspekt19/AllowLatch

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
AllowLatch Copilot (SERV on host)
  → draft policy, conflicts, assumptions, questions (Multipath / guard / shadow)
  → apply → MandatePolicy (JSON)
Financial agent (Spender)
  → before spend: evaluate / execute_gated_transfer (x402)
AllowLatch Gate (code, no LLM)
  → ALLOW | DENY | ESCALATE
AgentKit / CDP (host, if live)
  → sign Base USDC only on ALLOW (+ humanApproved on escalate)
```

| Layer | Tech | Role |
|-------|------|------|
| Copilot | SERV Reasoning (host) | Mandate, conflicts, injection resistance, explain |
| Gate | `src/policy/engine.ts` | Caps, symbols, addresses, velocity, escalate |
| Execute | AgentKit / CDP | Transaction only after green light |
| Connect | OpenServ x402 | Discovery + payment (no end-user keys) |

AllowLatch does **not** hold user funds. Host SERV credits are covered by x402 pricing.

**Target UX:** skills on the user’s existing agent — zero secrets for the human. Dialog UI + `npm run wow` show the full story.

---

## Policy surface (v1)

- Lifetime wallet budget (hard ledger ceiling) / max per order / daily notional / txs per hour  
- Allow / deny symbols, addresses, contracts; optional slippage / gas / emergency stop  
- Actions: transfer / swap / x402_pay (host **executes** transfer/x402 only; swap = evaluate + receipt for external routers)  
- Human-confirm threshold (escalate)  
- SQLite spend ledger + audit events; single-use allow-receipt required before execute  

Chain focus: **Base**. Policy currency: **USDC**.

Honest scope: AllowLatch is middleware authorization (+ receipt). Wallet-native Spend Permissions are roadmap — see [WALLET_NATIVE.md](./WALLET_NATIVE.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## What we are not

- Not a replacement for Coinbase / CDP wallets  
- Not a full on-chain spend vault yet (pair with wallet permissions for custody-grade caps)  
- Not an LLM allow/deny judge  
- Not a universal policy OS for non-financial domains  

---

## One-line pitch

> For a financial agent on Base: state rules in words → SERV drafts and explains → without ALLOW + valid allow-receipt, AgentKit does not move money.

---

## Build direction

| Layer | Status |
|-------|--------|
| Deterministic gate | Done (`engine.ts`) |
| SERV draft / revise / explain on host | Done |
| Receipt-required execute + jti consume | Done |
| SQLite atomic store + audit | Done |
| Generic HTTP gate | Done (`npm run http:gate`) |
| Live UI `/api/copilot` + injection chips | Done |
| WOW theater CLI | Done (`npm run wow`) |
| OpenServ x402 connect | Done |
| Wallet-native Spend Permissions | Roadmap — [WALLET_NATIVE.md](./WALLET_NATIVE.md) |
| Live CDP battle | Optional — see [BATTLE.md](./BATTLE.md) |

Verify:

```bash
npm run wow                 # SERV → injection → gate → explain → AgentKit
npm run demo
npm run http:gate
npm run battle
npm run ui
npm run typecheck
```
