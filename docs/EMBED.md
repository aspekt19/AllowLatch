# Enforce AllowLatch from your agent (paid)

You do **not** run AllowLatch yourself.

**Required path:** website Go live → Connect pack (`gateUrl` + `sessionSeal`) → **`createGatedAgentKit({ kind: 'site' })`** against https://allowlatch.vercel.app/api/gate.

**`assertSpend` is advisory** if a raw wallet/CDP signer still exists — use it only as a check, not as the sole control.

**Optional fallback:** OpenServ when site gate fails — `preferOpenServ: true`. See [GUIDE.md](./GUIDE.md) · [HOSTED.md](./HOSTED.md).

```ts
import { createGatedAgentKit } from 'allowlatch'
// npm i allowlatch@^0.2.0

const agent = await createGatedAgentKit({
  policyId: 'web-…',
  gate: {
    kind: 'site',
    gateUrl: 'https://allowlatch.vercel.app/api/gate',
    sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // x402 payer only
  },
})

await agent.transfer({
  toAddress: '0x…',
  amountUsd: 5,
  reason: 'gated spend',
})
```

Local `npm run http:gate` is optional for **offline development** — not the end-user product.

## Coming from Coinbase AgentKit

**Keep your agent.** Replace raw transfers with the gated kit:

1. Scaffold / keep AgentKit + CDP  
2. Wire `createGatedAgentKit({ gate: { kind: 'site', … } })` so spends cannot bypass AllowLatch  
3. Apply a mandate once (demo UI **Go live** / Connect pack)

Default host enforcement is **hybrid** (on-chain Spend Permissions when configured). See [WALLET_NATIVE.md](./WALLET_NATIVE.md).

AgentKit action provider (secondary):

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
npx allowlatch-mcp
# or: npm run mcp
```

Live CTA: https://allowlatch.vercel.app/#agentkit  
Hosted ops (not for end users): [HOSTED.md](./HOSTED.md)

## Advisory-only: assertSpend

```ts
import { assertSpend } from 'allowlatch'

// Does NOT remove a parallel raw signer — prefer createGatedAgentKit
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
```

## OpenServ fallback only

```ts
import { createGatedAgentKit } from 'allowlatch'

await createGatedAgentKit({
  gate: {
    kind: 'openserv',
    triggerUrl: process.env.ALLOWLATCH_TRIGGER_URL,
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  },
})
```
