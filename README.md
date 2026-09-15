# MandateGuard

**OpenServ + Coinbase AgentKit** — spending turnstile for AI wallets on Base.

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

MandateGuard does **not** custody user funds.

## Quick start

```bash
npm install
npm run ui      # minimal dialog UI (mandate → spender → allow/deny/escalate)
npm run demo    # CLI offline scenarios
cp .env.example .env
npm run dev     # provision OpenServ agent + x402 trigger
```

### Dialog UI

`npm run ui` opens a chat-style template:

1. **You** set the mandate (NL)
2. **MandateGuard** compiles a Base/USDC policy
3. **Spender** (AgentKit stand-in) proposes spends via chips or text
4. Guard answers **ALLOW / DENY / ESCALATE** (human yes/no on escalate)

Runs fully offline in the browser against the same policy engine. Production path still uses the OpenServ agent + AgentKit.

### Live AgentKit transfers (optional)

1. Create CDP keys at [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com)
2. Set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, `NETWORK_ID=base-sepolia`
3. Fund the agent wallet with test USDC
4. `MANDATEGUARD_EXECUTE_MODE=live npm run dev`

Without CDP credentials, `execute_gated_transfer` runs in **dry-run** (policy + ledger still apply).

## Capabilities

- `compile_mandate` — NL → `MandatePolicy`
- `get_policy` — inspect policy + ledger
- `evaluate_intent` — allow / deny / escalate
- `execute_gated_transfer` — evaluate then AgentKit USDC transfer (or dry-run)
- `reset_ledger` — demo helper

## Pitch (one line)

While others ship wallets with soft limits in code, MandateGuard is an OpenServ agent that turns your words into rules and will not let an AgentKit wallet spend outside them — with a reason every time.

## Hackathon notes

- Enable data collection: `console.openserv.ai/settings/organization`
- Submit with a public X post tagging **@openservai** + the official form
- Deadline: 28 September 2026 00:00 UTC

## License

ISC
