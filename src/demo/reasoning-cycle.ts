/**
 * Full cycle via SERV Reasoning + deterministic engine:
 * 1) compile mandate (Reasoning)
 * 2) run allow / deny / escalate scenarios
 *
 *   npm run reasoning:cycle
 *   npm run reasoning:cycle -- "your mandate text"
 */
import dotenv from 'dotenv'
dotenv.config()

import { MandatePolicySchema, type SpendIntent } from '../policy/schema.js'
import { commitIntent, evaluateIntent, freshLedger } from '../policy/engine.js'
import { servStructured } from '../llm/serv-reasoning.js'

const UNISWAP = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'

const DEFAULT_MANDATE =
  'Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap allowed. Ask me above $8. No meme coins.'

async function main() {
  const mandateText = process.argv.slice(2).join(' ').trim() || DEFAULT_MANDATE

  console.log('=== 1) Compile mandate via SERV Reasoning ===')
  console.log(mandateText)

  const policy = await servStructured({
    system:
      'You are SpendGate policy compiler. Output only valid structured MandatePolicy JSON for Base/USDC agent wallets. Be conservative on limits.',
    user: `Convert this human spending mandate into a MandatePolicy for Base (USDC only).

Mandate:
"""
${mandateText}
"""

Rules: version "1.0", chain "base", currency "USDC". Defaults if missing: maxPerOrderUsd 10, maxNotionalUsdPerDay 40, maxTransactionsPerHour 20, agentWalletBudgetUsd 200. If Uniswap mentioned, allow ${UNISWAP}. If "no meme" / PEPE denied, put PEPE in deniedSymbols.`,
    schema: MandatePolicySchema,
    schemaName: 'mandate_policy',
  })

  console.log(JSON.stringify(policy, null, 2))

  console.log('\n=== 2) Evaluate spends (deterministic engine, no LLM) ===')
  let ledger = freshLedger()

  const scenarios: { title: string; intent: SpendIntent; commit?: boolean }[] = [
    {
      title: 'ALLOW · $8 ETH via Uniswap',
      intent: {
        action: 'swap',
        amountUsd: 8,
        symbol: 'ETH',
        toAddress: UNISWAP,
        reason: 'Rebalance',
      },
      commit: true,
    },
    {
      title: 'DENY · PEPE',
      intent: {
        action: 'swap',
        amountUsd: 5,
        symbol: 'PEPE',
        toAddress: UNISWAP,
        reason: 'YOLO',
      },
    },
    {
      title: 'DENY · $50 over cap',
      intent: {
        action: 'transfer',
        amountUsd: 50,
        toAddress: UNISWAP,
        reason: 'Too big',
      },
    },
    {
      title: 'ESCALATE · above confirm threshold',
      intent: {
        action: 'transfer',
        amountUsd: Math.min(
          policy.capital.maxPerOrderUsd,
          policy.escalation.requireHumanConfirmAboveUsd + 0.5
        ),
        toAddress: UNISWAP,
        reason: 'Needs human',
      },
    },
    {
      title: 'DENY · unknown address',
      intent: {
        action: 'transfer',
        amountUsd: 3,
        toAddress: '0x000000000000000000000000000000000000dEaD',
        reason: 'Wrong paste',
      },
    },
  ]

  for (const s of scenarios) {
    // Skip escalate case if threshold >= maxPerOrder (cannot fire)
    if (
      s.title.startsWith('ESCALATE') &&
      policy.escalation.requireHumanConfirmAboveUsd >= policy.capital.maxPerOrderUsd
    ) {
      console.log(`\n▶ ${s.title}`)
      console.log('  (skipped — confirm threshold >= max per order in compiled policy)')
      continue
    }

    const result = evaluateIntent(policy, s.intent, ledger)
    console.log(`\n▶ ${s.title}`)
    console.log(`  → ${result.decision.toUpperCase()}`)
    for (const r of result.reasons) console.log(`    - ${r}`)
    if (result.decision === 'allow' && s.commit) {
      ledger = commitIntent(ledger, s.intent)
      console.log(`    ledger today: $${ledger.spentUsdToday}`)
    }
  }

  console.log('\nDone. Reasoning used for compile only; gate is local code.')
  console.log('UI demo: https://spendgate.vercel.app')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
