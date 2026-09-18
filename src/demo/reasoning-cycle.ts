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

import { type SpendIntent } from '../policy/schema.js'
import { commitIntent, evaluateIntent, freshLedger } from '../policy/engine.js'
import {
  BASE_UNISWAP_UNIVERSAL_ROUTER,
  compileMandateWithServ,
} from '../llm/compile-mandate.js'

const UNISWAP = BASE_UNISWAP_UNIVERSAL_ROUTER

const DEFAULT_MANDATE =
  'Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap allowed. Ask me above $8. No meme coins.'

async function main() {
  const mandateText = process.argv.slice(2).join(' ').trim() || DEFAULT_MANDATE

  console.log('=== 1) Compile mandate via SERV Reasoning ===')
  console.log(mandateText)

  const { policy, meta } = await compileMandateWithServ(mandateText)

  console.log(JSON.stringify(policy, null, 2))
  console.log(
    `[serv] model=${meta.model} prompt=${meta.promptVersion} effort=${meta.reasoningEffort} ${meta.latencyMs}ms`
  )

  console.log('\n=== 2) Evaluate spends (deterministic engine, no LLM) ===')
  let ledger = freshLedger()

  const scenarios: { title: string; intent: SpendIntent; commit?: boolean }[] = [
    {
      title: 'ALLOW · $8 ETH via Uniswap',
      intent: {
        action: 'swap',
        amountUsd: 8,
        calldataHash: '0x' + 'aa'.repeat(16),
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
        calldataHash: '0x' + 'aa'.repeat(16),
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
  console.log('UI demo: https://allowlatch.vercel.app')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
