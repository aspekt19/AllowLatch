# Enforce AllowLatch from your agent (paid)

You do **not** run AllowLatch yourself. Production path uses the **hosted** AllowLatch Gate:

1. Discover **AllowLatch Gate** on OpenServ (or use public trigger/paywall from [CONNECT.md](./CONNECT.md) / `/api/host-info`) — **$0.025**
2. Apply policy once (paywall / `payWorkflow` / `apply_policy`)
3. Before **every** spend: `assertSpend` / `evaluate` → ALLOW + single-use **receipt** (`jti`) → pass receipt into `execute_gated_transfer` → only then sign

Local `npm run http:gate` is optional for **offline development** of your agent — not the end-user product.

## New agent with gate baked in (recommended)

Coming from [Coinbase AgentKit](https://github.com/coinbase/agentkit)? **Keep your agent.** Add AllowLatch in front of spends.

1. Scaffold / keep your AgentKit + CDP project  
2. Before every transfer: `assertSpend` / `createGatedAgentKit` → ALLOW + receipt, then sign  
3. Apply a mandate once (demo UI **Enforce · $0.025** / paywall / `apply_policy`)

```ts
import { assertSpend } from 'allowlatch'
// npm i allowlatch

const { receipt } = await assertSpend({
  // From discoverServices().webhookUrl or https://allowlatch.vercel.app/api/host-info
  triggerUrl: process.env.ALLOWLATCH_TRIGGER_URL!,
  // x402 payer only — not necessarily the AgentKit/CDP signer key
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  intent: {
    action: 'transfer',
    amountUsd: 5,
    toAddress: '0x…',
  },
})
// only then AgentKit / execute_gated_transfer with receipt
```

Prefer `createGatedAgentKit` so the agent cannot call a raw signer in parallel. Default host enforcement is **hybrid** (on-chain Spend Permissions when configured).

AgentKit action provider:

```ts
import { AgentKit } from '@coinbase/agentkit'
import { allowLatchActionProvider } from 'allowlatch/action-provider'

const agentKit = await AgentKit.from({
  actionProviders: [allowLatchActionProvider()],
  // ...wallet
})
```

MCP (Cursor / Claude Desktop):

```bash
npm run mcp
# or after publish: npx allowlatch-mcp
```

Live CTA: https://allowlatch.vercel.app/#agentkit  
Hosted ops (not for end users): [HOSTED.md](./HOSTED.md)

## SDK (assert only)

```ts
import { assertSpend } from 'allowlatch'

const { receipt } = await assertSpend({
  intent: {
    action: 'transfer',
    amountUsd: 5,
    toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  },
  triggerUrl: process.env.ALLOWLATCH_TRIGGER_URL!, // discoverServices().webhookUrl
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // x402 payer only
})
```

Owner apply with EIP-712 (optional):

```ts
import { buildPolicyApplyTypedData } from 'allowlatch'
// sign typedData with owner wallet → pass ownerSig + ownerAddress into apply_policy
```

Examples: `examples/create-gated-agent.ts` · `examples/assert-spend-demo.ts`  
Monetization: [MONETIZE.md](./MONETIZE.md)

## Agent instruction

> Connect to the hosted AllowLatch Gate on OpenServ — do not ask me to run a server or set SERV_API_KEY. Before any transfer/swap/payment, call AllowLatch `assertSpend` / `evaluate_intent` (paid). Treat timeouts and API errors as DENY (fail-closed). On DENY stop. On ESCALATE ask me. Never sign without a valid allow-receipt. Prefer `tokenAddress` + matching `chainId` over symbol alone. For swaps, supply `calldataHash`. Put the gate in the wallet adapter (`createGatedAgentKit`) so you cannot call a raw signer in parallel.

## Demo-only snapshot

The website "Demo snapshot" export is watermarked (`enforcement: "demo-only"`). It is for inspection, not production.
