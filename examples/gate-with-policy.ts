/**
 * Load an exported MandatePolicy JSON and gate a spend locally
 * (same engine as the AllowLatch site / host).
 *
 *   npx tsx examples/gate-with-policy.ts path/to/mandate-policy.json
 *   npx tsx examples/gate-with-policy.ts path/to/mandate-policy.json 8 ETH
 *
 * Docs: docs/EMBED.md
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MandatePolicySchema, type SpendIntent } from '../src/policy/schema.js'
import { commitIntent, evaluateIntent, freshLedger } from '../src/policy/engine.js'

const UNISWAP = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'

const policyPath = process.argv[2]
if (!policyPath) {
  console.error('Usage: npx tsx examples/gate-with-policy.ts <mandate-policy.json> [amount] [symbol]')
  process.exit(1)
}

const amountUsd = Number(process.argv[3] ?? '5')
const symbol = (process.argv[4] ?? 'ETH').toUpperCase()

const policy = MandatePolicySchema.parse(
  JSON.parse(readFileSync(resolve(policyPath), 'utf8'))
)

const intent: SpendIntent = {
  action: 'swap',
  amountUsd,
  symbol,
  toAddress: UNISWAP,
  reason: 'embed-policy demo',
}

const ledger = freshLedger()
const result = evaluateIntent(policy, intent, ledger)

console.log('Policy:', policy.name)
console.log('Intent:', intent.action, `$${intent.amountUsd}`, intent.symbol)
console.log('Decision:', result.decision.toUpperCase())
for (const r of result.reasons) console.log(' •', r)

if (result.decision === 'allow') {
  const next = commitIntent(ledger, intent)
  console.log('\nALLOW — agent may sign now. Ledger today: $' + next.spentUsdToday)
  console.log('(Wire this check immediately before AgentKit / wallet sign.)')
} else if (result.decision === 'escalate') {
  console.log('\nESCALATE — ask the human; only sign after yes.')
} else {
  console.log('\nDENY — do not sign.')
  process.exitCode = 1
}
