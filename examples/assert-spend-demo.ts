/**
 * Paid remote gate demo.
 *
 *   ALLOWLATCH_TRIGGER_URL=... WALLET_PRIVATE_KEY=0x... npx tsx examples/assert-spend-demo.ts
 *
 * Discover triggerUrl via: npm run connect (prints webhook) or discoverServices().
 */
import dotenv from 'dotenv'
dotenv.config()

import { assertSpend } from '../src/sdk/assert-spend.js'

async function main() {
  const triggerUrl = process.env.ALLOWLATCH_TRIGGER_URL?.trim()
  if (!triggerUrl) {
    console.error('Set ALLOWLATCH_TRIGGER_URL (discoverServices webhookUrl).')
    process.exit(1)
  }
  if (!process.env.WALLET_PRIVATE_KEY?.trim()) {
    console.error('Set WALLET_PRIVATE_KEY for the x402 payer wallet.')
    process.exit(1)
  }

  const result = await assertSpend({
    triggerUrl,
    intent: {
      action: 'swap',
      amountUsd: 5,
      calldataHash: '0x' + 'aa'.repeat(16),
      symbol: 'ETH',
      toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
      reason: 'assert-spend demo',
    },
  })

  console.log('decision', result.decision)
  console.log('receipt', result.receipt)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
