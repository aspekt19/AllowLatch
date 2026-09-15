/**
 * Offline demo — no OpenServ credentials required.
 * Shows ALLOW / DENY / ESCALATE against the starter Base policy.
 */
import { DEMO_POLICY } from '../policy/schema.js'
import { commitIntent, evaluateIntent, freshLedger } from '../policy/engine.js'
import type { SpendIntent } from '../policy/schema.js'

const scenarios: { title: string; intent: SpendIntent; commit?: boolean }[] = [
  {
    title: 'OK swap under limits',
    intent: {
      action: 'swap',
      amountUsd: 8,
      symbol: 'ETH',
      toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
      reason: 'Rebalance idle USDC into ETH',
    },
    commit: true,
  },
  {
    title: 'Deny — meme coin not allowlisted',
    intent: {
      action: 'swap',
      amountUsd: 5,
      symbol: 'PEPE',
      toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
      reason: 'YOLO',
    },
  },
  {
    title: 'Deny — over per-order cap',
    intent: {
      action: 'transfer',
      amountUsd: 50,
      toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
      reason: 'Send to router',
    },
  },
  {
    title: 'Escalate — above human confirm threshold but under hard caps',
    intent: {
      action: 'x402_pay',
      amountUsd: 10.5,
      toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
      reason: 'Pay research API',
    },
  },
  {
    title: 'Deny — unknown destination',
    intent: {
      action: 'transfer',
      amountUsd: 3,
      toAddress: '0x000000000000000000000000000000000000dEaD',
      reason: 'Oops wrong address',
    },
  },
]

function main() {
  console.log('MandateGuard offline demo')
  console.log('Policy:', DEMO_POLICY.name)
  console.log(JSON.stringify(DEMO_POLICY.capital, null, 2))
  console.log('---')

  let ledger = freshLedger()

  for (const s of scenarios) {
    const result = evaluateIntent(DEMO_POLICY, s.intent, ledger)
    console.log(`\n▶ ${s.title}`)
    console.log(`  intent: ${s.intent.action} $${s.intent.amountUsd} ${s.intent.symbol ?? ''}`.trim())
    console.log(`  → ${result.decision.toUpperCase()}`)
    for (const r of result.reasons) console.log(`    - ${r}`)
    if (result.decision === 'allow' && s.commit) {
      ledger = commitIntent(ledger, s.intent)
      console.log(`    ledger today: $${ledger.spentUsdToday}`)
    }
  }

  console.log('\nDone. Run the OpenServ agent with: npm run dev')
}

main()
