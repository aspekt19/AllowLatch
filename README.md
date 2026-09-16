# SpendGate

**Policy Copilot + spending turnstile** for financial AI agents on Base (USDC / AgentKit).

**Live demo:** https://spendgate.vercel.app  
**Repo:** https://github.com/aspekt19/SpendGate  
**Connect:** [docs/CONNECT.md](./docs/CONNECT.md) · [llms.txt](./llms.txt) · [agent.json](./agent.json)

Human mandate → strict USDC policy → every spend is **allow / deny / escalate** → AgentKit moves funds **only after ALLOW**. Non-custodial. Host never stores end-user SERV keys.

> SERV Hackathon Edition 01 · track: **Coinbase AgentKit**

## For end users (the product)

Tell your agent:

> Connect to SpendGate. Enforce: max $10/tx, $40/day, only USDC and ETH, ask me above $8. Before any spend, ask SpendGate.

**One explicit step:** create an OpenServ Reasoning key and give it to *your* agent (not to SpendGate). No SIWE yet.

Your agent drafts the policy with that key, then calls the SpendGate gate over OpenServ x402 with MandatePolicy JSON only.

- Cursor skill: `.cursor/skills/spendgate` (also in your user Agent Store as `spendgate`)
- Demo UI: https://spendgate.vercel.app

## Problem

An agent with a funded Base wallet can drain itself via loops, bad addresses, or over-eager swaps. Prompt-level “be careful” is not a control.

## Solution

| Layer | Role |
|-------|------|
| Owner agent + SERV | Policy Copilot (owner’s Reasoning key) |
| OpenServ x402 host | Keyless gate other agents connect to |
| Deterministic engine | Caps, allowlists, escalate — not LLM judgment |
| Coinbase AgentKit | Signs USDC **only after ALLOW** |

## Capabilities

**Host (keyless):** `apply_policy` · `evaluate_intent` · `execute_gated_transfer` · `get_policy` · `reset_ledger`  

**Owner agent:** `ownerDraftPolicy` / `ownerRevisePolicy` / `ownerExplainDecision` (`src/owner/copilot.ts`)  

**Operator only** (optional host `SERV_API_KEY`): `draft_policy` / `revise_mandate` / `explain_decision`

## Operators / developers

```bash
npm install
npm run ui                  # local Policy Copilot demo UI
npm run owner:copilot       # owner SERV draft → apply_policy prompt
npm run battle              # Spender → gate → AgentKit dry-run
npm run connect             # discover SpendGate as another agent
npm run dev                 # provision + run OpenServ host (gate; SERV optional)
```

Host: no SERV required for consumer gate traffic; optional `SERV_API_KEY` for our self/dev Copilot; optional `CDP_*` for live execute.  
Live CDP checklist: [docs/BATTLE.md](./docs/BATTLE.md) · Product: [docs/PRODUCT.md](./docs/PRODUCT.md)

## Pitch (one line)

Say the rules to your agent; it drafts with your Reasoning key; SpendGate’s turnstile keeps AgentKit inside them.

## Hackathon notes

- Enable data collection: `console.openserv.ai/settings/organization`
- Submit with a public X post tagging **@openservai** + the official form
- Deadline: 28 September 2026 00:00 UTC

## License

ISC

## For coding agents

See [AGENTS.md](./AGENTS.md), [llms.txt](./llms.txt), and [`.cursorrules`](./.cursorrules).
