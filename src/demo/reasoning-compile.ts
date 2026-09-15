/**
 * Test SpendGate policy compile via SERV Reasoning (no Platform host required).
 *
 * Usage:
 *   SERV_API_KEY=... npm run reasoning:compile -- "Max $10 per tx, $40/day, only ETH and USDC"
 */
import dotenv from 'dotenv'
dotenv.config()

import { MandatePolicySchema } from '../policy/schema.js'
import { servStructured } from '../llm/serv-reasoning.js'

async function main() {
  const mandateText =
    process.argv.slice(2).join(' ').trim() ||
    'Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap allowed. Ask me above $8.'

  console.log('Compiling via SERV Reasoning…')
  console.log('Mandate:', mandateText)

  const policy = await servStructured({
    system:
      'You are SpendGate policy compiler. Output only valid structured MandatePolicy JSON for Base/USDC agent wallets. Be conservative on limits.',
    user: `Convert this human spending mandate into a MandatePolicy for Base (USDC only).

Mandate:
"""
${mandateText}
"""

Rules: version "1.0", chain "base", currency "USDC". Defaults if missing: maxPerOrderUsd 10, maxNotionalUsdPerDay 40, maxTransactionsPerHour 20, agentWalletBudgetUsd 200. If Uniswap mentioned, allow 0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD.`,
    schema: MandatePolicySchema,
    schemaName: 'mandate_policy',
  })

  console.log(JSON.stringify(policy, null, 2))
  console.log('\nOK — this used console.openserv.ai credits (SERV Reasoning).')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
