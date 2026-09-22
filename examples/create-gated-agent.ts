/**
 * Create an AgentKit-oriented agent with AllowLatch already wired.
 *
 * Preferred (production): site gate via Connect pack env:
 *   ALLOWLATCH_GATE_URL=https://allowlatch.vercel.app/api/gate
 *   ALLOWLATCH_SESSION_SEAL=…   # from website Go live
 *   WALLET_PRIVATE_KEY=…        # x402 payer only
 *   npm run agent:gated
 *
 * Local HTTP fallback (dev):
 *   npm run http:gate          # terminal A
 *   npm run agent:gated        # terminal B (defaults to http://127.0.0.1:8787)
 */
import dotenv from 'dotenv'
dotenv.config()

import { createGatedAgentKit } from '../src/sdk/gated-agentkit.js'
import { MandatePolicySchema } from '../src/policy/schema.js'

const DEMO_TO = '0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205'

const STARTER_POLICY = MandatePolicySchema.parse({
  version: '1.0',
  name: 'Gated AgentKit starter',
  chain: 'base',
  currency: 'USDC',
  capital: {
    agentWalletBudgetUsd: 2,
    maxNotionalUsdPerDay: 0.5,
    maxPerOrderUsd: 0.1,
    maxTransactionsPerHour: 30,
  },
  universe: {
    allowedSymbols: ['USDC'],
    deniedSymbols: [],
    allowedAddresses: [DEMO_TO],
    deniedAddresses: [],
    allowedContracts: [],
    deniedContracts: [],
    allowedFunctionSelectors: [],
    deniedFunctionSelectors: [],
  },
  actions: { allowSwap: false, allowTransfer: true, allowX402Pay: false },
  risk: { emergencyStop: false },
  escalation: { requireHumanConfirmAboveUsd: 0.05 },
})

async function main() {
  if (!process.env.ALLOWLATCH_RECEIPT_SECRET?.trim() && !process.env.SERV_API_KEY?.trim()) {
    process.env.ALLOWLATCH_RECEIPT_SECRET = 'gated-agent-dev-receipt-secret'
  }

  const policyId = process.env.ALLOWLATCH_POLICY_ID?.trim() || `gated-starter-${Date.now()}`
  const agent = await createGatedAgentKit({
    policyId,
    gate:
      process.env.ALLOWLATCH_GATE_URL?.trim() || process.env.ALLOWLATCH_SESSION_SEAL?.trim()
        ? {
            kind: 'site',
            gateUrl: process.env.ALLOWLATCH_GATE_URL?.trim() || 'https://allowlatch.vercel.app/api/gate',
            sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL?.trim(),
            walletPrivateKey: process.env.WALLET_PRIVATE_KEY?.trim() || process.env.AGENT_PRIVATE_KEY?.trim(),
            policyId,
          }
        : undefined,
  })

  console.log('=== AllowLatch · gated AgentKit ===')
  console.log('gate:', agent.gate.kind)
  console.log('policyId:', agent.policyId)
  console.log('\n--- System prompt (paste into your agent) ---\n')
  console.log(agent.systemPrompt)

  const has = await agent.hasPolicy()
  console.log('\npolicy on gate:', has === null ? 'n/a (site/OpenServ)' : has)

  console.log('\n1) Spend BEFORE rules → must fail closed (HTTP) or pay+deny (site)')
  try {
    await agent.transfer({ toAddress: DEMO_TO, amountUsd: 0.04, reason: 'should fail without policy' })
    console.error('UNEXPECTED: spend succeeded without policy')
    process.exit(1)
  } catch (err) {
    console.log('   blocked:', err instanceof Error ? err.message.slice(0, 200) : err)
  }

  if (agent.gate.kind === 'http') {
    console.log('\n2) Owner applies rules (HTTP gate)')
    await agent.applyPolicy(STARTER_POLICY, 'starter-owner')
    console.log('   applied:', STARTER_POLICY.name)

    console.log('\n3) Spend AFTER rules → gate + execute (dry-run unless CDP live)')
    const result = await agent.transfer({
      toAddress: DEMO_TO,
      amountUsd: 0.04,
      reason: 'starter gated transfer',
    })
    console.log('   result:', result.decision, result.executed, result.message.slice(0, 120))
  } else {
    console.log('\n2) Site/OpenServ: apply MandatePolicy via website Go live / Connect pack, then retry transfer.')
  }

  console.log('\nDone. Prefer kind: "site" in production. assertSpend alone is advisory.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
