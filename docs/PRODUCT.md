# AllowLatch - Product

**AllowLatch** is a control layer for financial AI agents with a wallet on Base (USDC). **Primary surface:** always-on Vercel `/api/gate` + Coinbase AgentKit via `createGatedAgentKit({ kind: 'site' })`. OpenServ is an optional marketplace fallback — the product is the gate, not a single SDK.

It is **not** a bank, not a custodian, and not an LLM that decides whether money may move.

It is a **Policy Copilot + hard turnstile**:

1. The owner states and revises spending rules in natural language.
2. **SERV Reasoning on the AllowLatch host** drafts the policy, surfaces conflicts, resists prompt injection, and explains denials (Multipath · prompt_guard · shadow).
3. Before every spend, **deterministic code** returns allow / deny / escalate - the LLM never overrides the verdict.
4. On the **supported signing path**, the spender moves funds **only after ALLOW** + a consumed allow-receipt (or escalate + `humanApproved` + `ownerToken`) — `createGatedAgentKit({ kind: 'site' })` consumes `jti` before it returns the receipt; host `execute_gated_transfer` consumes before it signs. A raw ungated key outside that path is out of scope for the middleware.

End users need **no API keys**. Agents connect via always-on Vercel `/api/gate` (native x402); OpenServ is optional fallback. Operator holds SERV (+ CDP for facilitator).

Live demo: https://allowlatch.vercel.app  
Repo: https://github.com/aspekt19/AllowLatch

---

## Problem

An agent with a funded Base wallet can drain itself through loops, bad destinations, over-eager swaps, or prompt injection. A chat instruction ("don't spend more than $10") is not a control.

Wallet SDKs (including AgentKit) do not by themselves enforce spend caps, destination allowlists, or human approval on transfers. Something must sit **in front of signing**.

---

## Goal

Give the owner of a financial agent a way to say **how money may be spent**, keep those rules maintainable in plain language, and ensure prompting alone cannot invent ALLOW (pair with createGatedAgentKit + hybrid Spend Permissions for stronger enforcement).

---

## Who it is for

| Who | Why |
|-----|-----|
| Owners of AI agents with wallets | Mandate in words → policy → auditable decisions |
| Builders on Base / AgentKit | First integration path: keep your agent, add the latch (`createGatedAgentKit`) |
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
  → sign Base USDC only on ALLOW (+ humanApproved+ownerToken on escalate; site kit consumes jti)
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
- Spend ledger: **Turso** on always-on `/api/gate` when configured; **SQLite** on operator HTTP/OpenServ host; single-use allow-receipt required before execute 

Chain focus: **Base**. Policy currency: **USDC**.

Honest scope: AllowLatch is middleware authorization (+ receipt) for **AgentKit / CDP agents** **and**, by default (`ALLOWLATCH_ENFORCEMENT=hybrid`), mirrors daily USDC caps into Coinbase Spend Permissions when a funded Smart Account grants the AgentKit wallet (primary: agent `hybrid_plan` via Copy for my AI; operator: `sync_wallet` / host `ALLOWLATCH_SMART_ACCOUNT`). Middleware alone is not custody-grade if a signer can bypass the gate — and **a funded treasury private key in the agent defeats the on-chain ceiling**. The site does not offer MetaMask Connect. Put the gate in `createGatedAgentKit` / host execute. Policy mutates require `ownerToken`. See [WALLET_NATIVE.md](./WALLET_NATIVE.md) · [SECURITY.md](./SECURITY.md).

The public site (allowlatch.vercel.app) is the **product UI + always-on gate** (`/api/gate`). OpenServ is optional fallback. Details: [GUIDE.md](./GUIDE.md) · [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## MVP

This is the shipped product on https://allowlatch.vercel.app (`GET /api/gate` → `durable: true`):

1. Owner writes a mandate → SERV drafts a `MandatePolicy` (never the verdict).
2. Every spend hits `engine.ts`: **allow / deny / escalate**.
3. ALLOW (or escalate cleared with `humanApproved` + `ownerToken`) issues an action-bound receipt and reserves budget.
4. `createGatedAgentKit({ kind: 'site' })` **consumes** `jti`, then the caller may sign that intent.
5. Unused receipts past `expiresAt` release the reserved budget on the next evaluate.
6. Agents pay **$0.025** USDC x402, or `buy_pack` credits. Optional hybrid Spend Permission is a daily on-chain ceiling when the treasury key stays off the agent.

Not in this MVP: a third-party audit, swap-calldata economics (swaps stay off), or a vault that can stop an agent who already holds the funded private key.

## What we are not

- Not a replacement for Coinbase / CDP wallets  
- Not a full on-chain spend vault yet (pair with wallet permissions for custody-grade caps)  
- Not an LLM allow/deny judge  
- Not a universal policy OS for non-financial domains  
- Not unqualified “non-custodial” when the host holds CDP keys for `execute_gated_transfer` — that path is operator-hosted execution after ALLOW  

---

## Recommended production shape

| Step | Do this |
|------|---------|
| 1 | `createGatedAgentKit({ kind: 'site' })` only — no parallel raw signer |
| 2 | Optional AgentKit ceiling — Copy for my AI → `hybrid_plan` (hybrid = defense-in-depth daily USDC; re-sync after capital changes; `wallet_native` for hard stop) |
| 3 | Human confirms SERV draft before Go live; Turso + `ALLOWLATCH_RECEIPT_SECRET` for durable gate |
| 4 | Coffee-money hot wallet; `buy_pack` / `packKey` for micro evaluates; reject → no receipt |

Without (1)+(2), AllowLatch is a useful advisor and denial journal — not a physical lock. See [SECURITY.md](./SECURITY.md) · `recommendProductionShape()` in the SDK.

## One-line pitch

> For a financial agent on Base: state rules in words → SERV drafts → on the gated path, sign only after ALLOW, a consumed receipt, and (when escalated) owner approval. Hybrid Spend Permissions add a daily on-chain ceiling. A funded raw key outside that path can still move funds.

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
