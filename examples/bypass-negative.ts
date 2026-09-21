/**
 * Negative demo: raw AgentKit-style spend WITHOUT the latch is the failure mode.
 * Gated path refuses until ALLOW + receipt.
 *
 *   npx tsx examples/bypass-negative.ts
 */
import { assertSpend, createGatedAgentKit } from '../src/index.js'

async function main() {
  console.log('=== Bypass negative case ===\n')

  console.log('1) Ungated mental model (BAD):')
  console.log('   agent.wallet.sendTransaction(...)  // no assertSpend → drain risk')
  console.log('   AllowLatch cannot stop this if the key is raw-accessible.\n')

  console.log('2) Gated path (GOOD): createGatedAgentKit / assertSpend before sign')
  try {
    await assertSpend({
      policyId: 'no-such-policy',
      gateUrl: process.env.ALLOWLATCH_GATE_URL || 'https://allowlatch.vercel.app/api/gate',
      sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
      walletPrivateKey: process.env.WALLET_PRIVATE_KEY || '0x' + '11'.repeat(32),
      intent: {
        action: 'transfer',
        amountUsd: 1,
        symbol: 'USDC',
        toAddress: '0x0000000000000000000000000000000000000001',
        chainId: 8453,
      },
    })
    console.log('   unexpected ALLOW')
  } catch (err) {
    console.log(`   fail-closed: ${(err as Error).message.slice(0, 160)}…`)
  }

  const agent = await createGatedAgentKit({
    policyId: 'demo',
    gate: {
      kind: 'site',
      gateUrl: process.env.ALLOWLATCH_GATE_URL || 'https://allowlatch.vercel.app/api/gate',
      sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
      walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
    },
  })
  console.log(`\n3) createGatedAgentKit kind=${agent.gate.kind}`)
  console.log('   Prefer this over chat instructions. Pair with hybrid Spend Permissions.')
  console.log('\nDone. See docs/SECURITY.md — middleware alone is not custody-grade.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
