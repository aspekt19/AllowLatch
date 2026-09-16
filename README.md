# SpendGate

**OpenServ + Coinbase AgentKit** — spending turnstile for AI wallets on Base.

> Formerly explored as “MandateGuard”; renamed to avoid collision with unrelated projects using that name.

**Live demo:** https://spendgate.vercel.app  
**Repo:** https://github.com/aspekt19/SpendGate  

**Brain:** [SERV Reasoning](https://console.openserv.ai) (`SERV_API_KEY` → `inference-api.openserv.ai`)  
**Optional host:** OpenServ Platform agent + x402 (orchestration), not a substitute for Reasoning.

Human mandate → strict USDC policy → every spend is **allow / deny / escalate** → AgentKit moves funds **only after ALLOW**.

> SERV Hackathon Edition 01 · track: **Coinbase AgentKit**

## Problem

An agent with a funded Base wallet can drain itself via loops, bad addresses, or over-eager swaps. Prompt-level “be careful” is not a control.

## Solution

| Layer | Role |
|-------|------|
| OpenServ agent | Compile NL mandate → policy; expose evaluate / gated execute |
| Deterministic engine | Hard caps, allowlists, velocity limits (not LLM judgment) |
| Coinbase AgentKit | Sign USDC transfers on Base **only if** policy allows |

SpendGate does **not** custody user funds.

## Quick start

```bash
npm install
npm run reasoning:ping      # SERV Reasoning smoke test
npm run reasoning:draft     # Policy Copilot: draft + conflicts/questions
npm run reasoning:copilot   # Full cycle: draft → revise → gate → explain
npm run reasoning:cycle     # Reasoning compile → allow/deny/escalate
npm run battle              # Spender → SpendGate → AgentKit (dry-run without CDP)
npm run ui                  # local dialog UI
npm run demo                # offline engine-only scenarios
```

**Live UI:** https://spendgate.vercel.app  
**Product definition:** [docs/PRODUCT.md](./docs/PRODUCT.md)  
**Real battle (Spender + gate + AgentKit):** [docs/BATTLE.md](./docs/BATTLE.md)

### Dialog UI

`npm run ui` / production on Vercel — chat template:

1. **You** set the mandate (NL)
2. **SpendGate** compiles a Base/USDC policy (offline heuristics in UI; Reasoning via CLI scripts)
3. **Spender** proposes spends → **ALLOW / DENY / ESCALATE**

UI Spender is simulated. Live path: `npm run battle` (see [docs/BATTLE.md](./docs/BATTLE.md)).

### Live AgentKit transfers

1. Create CDP keys at [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com)
2. Set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, `NETWORK_ID=base-sepolia`
3. Fund the agent wallet with Sepolia ETH + test USDC
4. `npm run battle -- --live`

Without CDP credentials, battle / `execute_gated_transfer` runs in **dry-run** (policy + ledger still apply).
## Capabilities

- `compile_mandate` — NL → `MandatePolicy`
- `get_policy` — inspect policy + ledger
- `evaluate_intent` — allow / deny / escalate
- `execute_gated_transfer` — evaluate then AgentKit USDC transfer (or dry-run)
- `reset_ledger` — demo helper

## Pitch (one line)

While others ship wallets with soft limits in code, SpendGate is an OpenServ agent that turns your words into rules and will not let an AgentKit wallet spend outside them — with a reason every time.

## Hackathon notes

- Enable data collection: `console.openserv.ai/settings/organization`
- Submit with a public X post tagging **@openservai** + the official form
- Deadline: 28 September 2026 00:00 UTC

## License

ISC

## For coding agents

See [AGENTS.md](./AGENTS.md) and [`.cursorrules`](./.cursorrules).
