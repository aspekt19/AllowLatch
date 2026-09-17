# Enforce AllowLatch from your agent (paid)

Local JSON is **not** the product. Production path:

1. Host must be running (`npm run dev`) with x402 price **$0.025** — or `npm run http:gate` for a framework-agnostic HTTP API
2. Apply policy on the host (paywall / `payWorkflow` / `POST /v1/policies/:id`)
3. Before **every** spend: `assertSpend` / `evaluate` → ALLOW + single-use **receipt** (`jti`) → pass receipt into `execute_gated_transfer` / `POST /v1/execute` → only then sign

## New agent with gate baked in (recommended)

Create the AgentKit spender so **spend always hits AllowLatch** from day one. Rules can be applied later; until then transfers fail closed. Non-spend work is unconstrained.

```ts
import { createGatedAgentKit } from './src/sdk/gated-agentkit.js'

const agent = await createGatedAgentKit({
  // default: HTTP gate at ALLOWLATCH_HTTP_URL or http://127.0.0.1:8787
  // or OpenServ: set ALLOWLATCH_TRIGGER_URL (+ WALLET_PRIVATE_KEY); ALLOWLATCH_EXECUTE_ON_HOST=1 for host execute
})

// paste agent.systemPrompt into your LLM agent
await agent.applyPolicy(mandatePolicyJson) // HTTP gate
await agent.transfer({ toAddress: '0x…', amountUsd: 5 })
```

```bash
npm run http:gate    # terminal A
npm run agent:gated  # terminal B — demo fail-closed → apply → gated transfer
```

## SDK (assert only)

```ts
import { assertSpend } from './src/sdk/assert-spend.js'

const { receipt } = await assertSpend({
  intent: {
    action: 'transfer',
    amountUsd: 5,
    toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  },
  triggerUrl: process.env.ALLOWLATCH_TRIGGER_URL!, // discoverServices().webhookUrl
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // payer for x402
})

// verifyAllowReceipt is already required inside assertSpend when requireReceipt=true
// Pass the same receipt into execute_gated_transfer — host consumes jti (replay blocked)
```

HTTP alternative (no OpenServ): [ARCHITECTURE.md](./ARCHITECTURE.md) · `npm run http:gate`

Examples: `examples/create-gated-agent.ts` · `examples/assert-spend-demo.ts`  
Monetization: [MONETIZE.md](./MONETIZE.md)

## Agent instruction

> Before any transfer/swap/payment, call AllowLatch `assertSpend` / `evaluate_intent` (paid). On DENY stop. On ESCALATE ask me. Never sign without a valid allow-receipt. Never rely on a local JSON file for live spends. For host-executed transfers, pass the receipt into `execute_gated_transfer`.

## Demo-only snapshot

The website “Demo snapshot” export is watermarked (`enforcement: "demo-only"`). It is for inspection, not production.
