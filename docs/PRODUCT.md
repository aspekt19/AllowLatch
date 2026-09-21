# AllowLatch - Product

**AllowLatch** is a control layer for financial AI agents with a wallet on Base (USDC). Primary integrations today: OpenServ + Coinbase AgentKit - the product is the gate, not a single SDK.

It is **not** a bank, not a custodian, and not an LLM that decides whether money may move.

It is a **Policy Copilot + hard turnstile**:

1. The owner states and revises spending rules in natural language.
2. **SERV Reasoning on the AllowLatch host** drafts the policy, surfaces conflicts, resists prompt injection, and explains denials (Multipath · prompt_guard · shadow).
3. Before every spend, **deterministic code** returns allow / deny / escalate - the LLM never overrides the verdict.
4. The spender agent may move funds **only after ALLOW** (or escalate + explicit human approval), typically via AgentKit/CDP or host `execute_gated_transfer`.

End users need **no API keys**. Agents connect via always-on Vercel `/api/gate` (native x402); OpenServ is optional fallback. Operator holds SERV (+ CDP for facilitator).

Live demo: https://allowlatch.vercel.app  
Repo: https://github.com/aspekt19/AllowLatch

---

## Problem

An agent with a funded Base wallet can drain itself through loops, bad destinations, over-eager swaps, or prompt injection. A chat instruction ("don't spend more than $10") is not a control.

Wallet SDKs (including AgentKit) do not by themselves enforce spend caps, destination allowlists, or human approval on transfers. Something must sit **in front of signing**.

---

## Goal

Give the owner of a financial agent a way to say **how money may be spent**, keep those rules maintainable in plain language, and ensure the agent cannot bypass them via prompting or mistakes.

---

## Who it is for

| Who | Why |
|-----|-----|
| Owners of AI agents with wallets | Mandate in words → policy → auditable decisions |
| Builders on Base / AgentKit / OpenServ | First integration path: keep your agent, add the latch |
| Operators of paying / x402 agents | Limits, addresses, escalation without re-coding every time |

Out of scope: retail banking UX, and "any rules for any agents" outside finance.

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
Wallet / AgentKit / CDP (after ALLOW)
  → sign Base USDC only on ALLOW (+ humanApproved on escalate)
```

| Layer | Tech | Role |
|-------|------|------|
| Copilot | SERV Reasoning (host) | Mandate, conflicts, injection resistance, explain |
| Gate | `src/policy/engine.ts` | Caps, symbols, addresses, velocity, escalate |
| Execute | AgentKit / CDP (optional host) | Transaction only after green light |
| Connect | Vercel `/api/gate` + native x402 | Always-on discovery + payment (no end-user keys) |
| Fallback | OpenServ x402 | Optional marketplace path |

AllowLatch does **not** hold user funds. Host SERV credits are covered by x402 pricing.

**Target UX:** skills on the user's existing agent - zero secrets for the human. Dialog UI + `npm run wow` show the full story. Embed path: [EMBED.md](./EMBED.md).

---

## Policy surface (v1)

- Lifetime wallet budget (hard ledger ceiling) / max per order / daily notional / txs per hour  
- Allow / deny symbols, addresses, contracts; optional slippage / gas / emergency stop  
- Actions: transfer / swap / x402_pay (host **executes** transfer/x402 only; swap = evaluate + receipt for external routers)  
- Human-confirm threshold (escalate)  
- SQLite spend ledger + audit events; single-use allow-receipt required before execute  

Chain focus: **Base**. Policy currency: **USDC**.

Honest scope: AllowLatch is middleware authorization (+ receipt) **and**, by default (`ALLOWLATCH_ENFORCEMENT=hybrid`), mirrors daily USDC caps into Coinbase Spend Permissions when `ALLOWLATCH_SMART_ACCOUNT` is set. Middleware alone is not custody-grade if a signer can bypass the gate — put the gate in `createGatedAgentKit` / host execute. Policy mutates require `ownerToken` (spender `evaluate` cannot rewrite limits). See [WALLET_NATIVE.md](./WALLET_NATIVE.md) · [SECURITY.md](./SECURITY.md).

The public site (allowlatch.vercel.app) is the **product UI + always-on gate** (`/api/gate`). OpenServ is optional fallback. Details: [GUIDE.md](./GUIDE.md) · [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## What we are not

- Not a replacement for Coinbase / CDP wallets  
- Not a full on-chain spend vault yet (pair with wallet permissions for custody-grade caps)  
- Not an LLM allow/deny judge  
- Not a universal policy OS for non-financial domains  
- Not unqualified “non-custodial” when the host holds CDP keys for `execute_gated_transfer` — that path is operator-hosted execution after ALLOW  

---

## One-line pitch

> For a financial agent on Base: state rules in words → SERV drafts → without ALLOW + valid allow-receipt on a gated signer (prefer hybrid Spend Permissions), the wallet should not move money.

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
| Always-on `/api/gate` + native x402 | Done |
| OpenServ x402 fallback | Optional |
| Wallet-native Spend Permissions | Done (hybrid/wallet_native via CDP) - [WALLET_NATIVE.md](./WALLET_NATIVE.md) |
| EIP-712 owner sig on apply | Done (`src/auth/policy-eip712.ts`) |
| Property tests (engine) | Done (`engine.property.test.ts`) |
| Store abstraction | Done (`PolicyStoreApi` + `createStore`) — SQLite backend |
| npm SDK + AgentKit action provider + MCP | Done (`allowlatch`, `npm run mcp`) |
| Live CDP battle | Optional - see [BATTLE.md](./BATTLE.md) |
| External security audit | Not yet — required before large balances |

Verify:

```bash
npm run wow                 # SERV → injection → gate → explain → AgentKit
npm run demo
npm run http:gate
npm run battle
npm run ui
npm run typecheck
```
