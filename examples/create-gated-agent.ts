/**
 * Create a new AgentKit-oriented agent with AllowLatch already wired.
 *
 * Default: HTTP gate (npm run http:gate in another terminal).
 * OpenServ: set ALLOWLATCH_TRIGGER_URL (+ WALLET_PRIVATE_KEY); optional ALLOWLATCH_EXECUTE_ON_HOST=1.
 *
 *   npm run http:gate          # terminal A
 *   npm run agent:gated        # terminal B
 */
import dotenv from 'dotenv'
dotenv.config()

import { createGatedAgentKit } from '../src/sdk/gated-agentkit.js'
import { MandatePolicySchema } from '../src/policy/schema.js'

const DEMO_TO = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'

const STARTER_POLICY = MandatePolicySchema.parse({
  version: '1.0',
  name: 'Gated AgentKit starter',
  chain: 'base-sepolia',
  currency: 'USDC',
  capital: {
    agentWalletBudgetUsd: 200,
    maxNotionalUsdPerDay: 40,
    maxPerOrderUsd: 10,
    maxTransactionsPerHour: 30,
  },
  universe: {
    allowedSymbols: ['USDC', 'ETH', 'WETH'],
    deniedSymbols: ['PEPE', 'DOGE', 'SHIB'],
    allowedAddresses: [DEMO_TO],
    deniedAddresses: [],
    allowedContracts: [],
    deniedContracts: [],
    allowedFunctionSelectors: [],
    deniedFunctionSelectors: [],
  },
  actions: { allowSwap: true, allowTransfer: true, allowX402Pay: true },
  risk: { emergencyStop: false },
  escalation: { requireHumanConfirmAboveUsd: 8 },
})

async function main() {
  if (!process.env.ALLOWLATCH_RECEIPT_SECRET?.trim() && !process.env.SERV_API_KEY?.trim()) {
    process.env.ALLOWLATCH_RECEIPT_SECRET = 'gated-agent-dev-receipt-secret'
  }

  // Fresh policy id so "no rules yet" is real even if `default` exists from other demos.
  const policyId = `gated-starter-${Date.now()}`
  const agent = await createGatedAgentKit({ policyId })

  console.log('=== AllowLatch · gated AgentKit (from day one) ===')
  console.log('gate:', agent.gate.kind)
  console.log('policyId:', agent.policyId)
  console.log('\n--- System prompt (paste into your agent) ---\n')
  console.log(agent.systemPrompt)

  const has = await agent.hasPolicy()
  console.log('\npolicy on gate:', has === null ? 'unknown (OpenServ)' : has)

  console.log('\n1) Spend BEFORE rules → must fail closed')
  try {
    await agent.transfer({ toAddress: DEMO_TO, amountUsd: 5, reason: 'should fail' })
    console.error('UNEXPECTED: spend succeeded without policy')
    process.exit(1)
  } catch (err) {
    console.log('   blocked:', err instanceof Error ? err.message.slice(0, 160) : err)
  }

  if (agent.gate.kind === 'http') {
    console.log('\n2) Owner applies rules later (optional until first spend)')
    await agent.applyPolicy(STARTER_POLICY, 'starter-owner')
    console.log('   applied:', STARTER_POLICY.name)

    console.log('\n3) Spend AFTER rules → gate + execute (dry-run unless CDP live)')
    const result = await agent.transfer({
      toAddress: DEMO_TO,
      amountUsd: 5,
      reason: 'starter gated transfer',
    })
    console.log('   decision:', result.decision)
    console.log('   executed:', result.executed)
    console.log('   message:', result.message)
    if (result.txHash) console.log('   tx:', result.txHash)
  } else {
    console.log(
      '\n2) OpenServ: apply mandate via paywall / payWorkflow (apply_policy), then retry transfer.'
    )
    console.log('   executeOnHost:', agent.gate.kind === 'openserv' && agent.gate.executeOnHost)
  }

  console.log('\nDone. Non-spend agent features stay unconstrained; only money hits the gate.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
