# Enforce AllowLatch from your agent (paid)

Local JSON is **not** the product. Production path:

1. Host must be running (`npm run dev`) with x402 price **$0.025** - or `npm run http:gate` for a framework-agnostic HTTP API
2. Apply policy on the host (paywall / `payWorkflow` / `POST /v1/policies/:id`)
3. Before **every** spend: `assertSpend` / `evaluate` → ALLOW + single-use **receipt** (`jti`) → pass receipt into `execute_gated_transfer` / `POST /v1/execute` → only then sign

## New agent with gate baked in (recommended)

Coming from [Coinbase AgentKit](https://github.com/coinbase/agentkit)? **Keep your agent.** Add AllowLatch in front of spends - do not replace your repo with ours.

1. Scaffold / keep your AgentKit + CDP project  
2. Before every transfer: `assertSpend` / `createGatedAgentKit` → ALLOW + receipt, then sign  
3. Apply a mandate once (demo UI **Enforce · $0.025** / paywall / `apply_policy`)

```ts
import { assertSpend } from './assert-spend.js' // copy from AllowLatch src/sdk/

const { receipt } = await assertSpend({
  triggerUrl: process.env.ALLOWLATCH_TRIGGER_URL!,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  intent: {
    action: 'transfer',
    amountUsd: 5,
    toAddress: '0x…',
  },
})
// only then AgentKit / execute_gated_transfer with receipt
```

Optional: open https://codespaces.new/aspekt19/AllowLatch to **see a demo** of the gate - that is not how you ship your product agent.

Live CTA: https://allowlatch.vercel.app/#agentkit

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
// Pass the same receipt into execute_gated_transfer - host consumes jti (replay blocked)
```

HTTP alternative (no OpenServ): [ARCHITECTURE.md](./ARCHITECTURE.md) · `npm run http:gate`

Examples: `examples/create-gated-agent.ts` · `examples/assert-spend-demo.ts`  
Monetization: [MONETIZE.md](./MONETIZE.md)

## Agent instruction

> Before any transfer/swap/payment, call AllowLatch `assertSpend` / `evaluate_intent` (paid). On DENY stop. On ESCALATE ask me. Never sign without a valid allow-receipt. Never rely on a local JSON file for live spends. For host-executed transfers, pass the receipt into `execute_gated_transfer`.

## Demo-only snapshot

The website “Demo snapshot” export is watermarked (`enforcement: "demo-only"`). It is for inspection, not production.
