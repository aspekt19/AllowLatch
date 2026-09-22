# Enforce AllowLatch from your agent (paid)

You do **not** run AllowLatch yourself. **Primary:** website Go live → Connect pack (`gateUrl` + `sessionSeal`) → `assertSpend` against https://allowlatch.vercel.app/api/gate (always-on).

**Optional fallback:** OpenServ when site gate fails — `assertSpend({ triggerUrl, preferOpenServ: true })`. See [GUIDE.md](./GUIDE.md) · [HOSTED.md](./HOSTED.md).

```ts
import { assertSpend } from 'allowlatch'

await assertSpend({
  policyId: 'web-…',
  gateUrl: 'https://allowlatch.vercel.app/api/gate',
  sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // x402 payer only
  intent: {
    action: 'transfer',
    amountUsd: 5,
    toAddress: '0x…',
    symbol: 'USDC',
    tokenAmount: '5000000', // required for USDC — 6 decimals
  },
})
```

Local `npm run http:gate` is optional for **offline development** of your agent — not the end-user product.

## New agent with gate baked in (recommended)

Coming from [Coinbase AgentKit](https://github.com/coinbase/agentkit)? **Keep your agent.** Add AllowLatch in front of spends.

1. Scaffold / keep your AgentKit + CDP project  
2. Before every transfer: `assertSpend` / `createGatedAgentKit` → ALLOW + receipt, then sign  
3. Apply a mandate once (demo UI **Go live** / Connect pack)

```ts
import { createGatedAgentKit, assertSpend } from 'allowlatch'
// npm i allowlatch

// Preferred — signer cannot bypass the latch
const agent = await createGatedAgentKit({
  gate: {
    kind: 'site',
    gateUrl: 'https://allowlatch.vercel.app/api/gate',
    sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
  },
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // x402 payer
})

// Or assert-only:
const { receipt } = await assertSpend({
  gateUrl: 'https://allowlatch.vercel.app/api/gate',
  sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  intent: {
    action: 'transfer',
    amountUsd: 5,
    toAddress: '0x…',
    symbol: 'USDC',
    tokenAmount: '5000000',
  },
})
// only then AgentKit / execute_gated_transfer with receipt
```

Default host enforcement is **hybrid** (on-chain Spend Permissions when configured).

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

## OpenServ fallback only

```ts
await assertSpend({
  preferOpenServ: true,
  triggerUrl: process.env.ALLOWLATCH_TRIGGER_URL,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  intent: { /* … */ },
})
```
