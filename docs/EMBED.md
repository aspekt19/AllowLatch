# Enforce SpendGate from your agent (paid)

Local JSON is **not** the product. Production path:

1. Host must be running (`npm run dev`) with x402 price **$0.10**
2. Apply policy on the host (paywall or `payWorkflow`)
3. Before **every** spend: `assertSpend` → ALLOW + short-lived **receipt** → only then sign

## SDK

```ts
import { assertSpend } from './src/sdk/assert-spend.js'

const { receipt } = await assertSpend({
  intent: {
    action: 'swap',
    amountUsd: 5,
    symbol: 'ETH',
    toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  },
  triggerUrl: process.env.SPENDGATE_TRIGGER_URL!, // discoverServices().webhookUrl
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // payer for x402
})

// verifyAllowReceipt is already required inside assertSpend when requireReceipt=true
// Now AgentKit may sign — receipt expires in ~60s
```

Example: `examples/assert-spend-demo.ts`  
Monetization: [MONETIZE.md](./MONETIZE.md)

## Agent instruction

> Before any transfer/swap/payment, call SpendGate `assertSpend` / `evaluate_intent` (paid). On DENY stop. On ESCALATE ask me. Never sign without a valid allow-receipt. Never rely on a local JSON file for live spends.

## Demo-only snapshot

The website “Demo snapshot” export is watermarked (`enforcement: "demo-only"`). It is for inspection, not production.
