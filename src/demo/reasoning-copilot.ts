/**
 * Full Policy Copilot cycle via SERV:
 * draft → (optional revise) → apply → gate → explain_decision
 *
 *   npm run reasoning:copilot
 */
import dotenv from 'dotenv'
dotenv.config()

import { evaluateIntent, freshLedger } from '../policy/engine.js'
import { PolicyStore } from '../store/fs-store.js'
import {
  BASE_UNISWAP_UNIVERSAL_ROUTER,
  draftPolicyWithServ,
  revisePolicyWithServ,
} from '../llm/compile-mandate.js'
import { explainDecisionWithServ } from '../llm/explain-decision.js'
import type { SpendIntent } from '../policy/schema.js'

const POLICY_ID = 'copilot'
const UNISWAP = BASE_UNISWAP_UNIVERSAL_ROUTER

const MESSY_MANDATE =
  process.argv.slice(2).join(' ').trim() ||
  `Agent wallet about $200. Maybe $10 per transfer or wait maybe $25?
$40 a day but weekends can be higher. Only USDC and ETH, Uniswap ok.
Ask me above $8. No memes. Also allow any address I guess? Wait no, only Uniswap.`

async function main() {
  console.log('=== AllowLatch Policy Copilot ===\n')
  console.log('1) draft_policy\n', MESSY_MANDATE, '\n')

  const { draft, meta: draftMeta } = await draftPolicyWithServ(MESSY_MANDATE)
  console.log('Summary:', draft.summary)
  console.log('Ready to apply:', draft.readyToApply)
  for (const c of draft.conflicts) console.log('  conflict ·', c)
  for (const a of draft.assumptions) console.log('  assume  ·', a)
  for (const q of draft.questions) console.log('  ask     ·', q)
  console.log(`[serv] draft ${draftMeta.latencyMs}ms model=${draftMeta.model}\n`)

  let policy = draft.policy
  if (!draft.readyToApply) {
    console.log('2) revise_mandate (owner clarifies)\n')
    const { draft: revised, meta: revMeta } = await revisePolicyWithServ({
      currentPolicy: policy,
      revisionText:
        'Use $10 max per transfer. Keep $40 every day including weekends. Destinations: Uniswap only.',
    })
    policy = revised.policy
    console.log('Revised summary:', revised.summary)
    console.log('Ready to apply:', revised.readyToApply)
    for (const q of revised.questions) console.log('  ask ·', q)
    console.log(`[serv] revise ${revMeta.latencyMs}ms\n`)
  } else {
    console.log('2) revise_mandate skipped (draft already ready)\n')
  }

  const store = new PolicyStore()
  await store.init()
  await store.setPolicy(POLICY_ID, policy, undefined, undefined, { skipAuth: true })
  console.log('3) apply_policy → stored as', POLICY_ID)
  console.log(JSON.stringify(policy.capital, null, 2), '\n')

  const intent: SpendIntent = {
    action: 'swap',
    amountUsd: 5,
    calldataHash: '0x' + 'aa'.repeat(16),
    symbol: 'PEPE',
    toAddress: UNISWAP,
    reason: 'YOLO meme',
  }
  console.log('4) evaluate_intent (deterministic gate)')
  const evaluation = evaluateIntent(policy, intent, freshLedger())
  console.log(`   → ${evaluation.decision.toUpperCase()}`)
  for (const r of evaluation.reasons) console.log('     •', r)

  console.log('\n5) explain_decision (SERV Copilot)')
  const { explanation, meta: exMeta } = await explainDecisionWithServ({ policy, evaluation })
  console.log('   ', explanation.headline)
  console.log('   ', explanation.explanation)
  if (explanation.suggestedMandateChanges.length) {
    console.log('   Suggested mandate edits:')
    for (const s of explanation.suggestedMandateChanges) console.log('     →', s)
  }
  console.log(`[serv] explain ${exMeta.latencyMs}ms`)
  console.log('\nDone. Gate stayed deterministic; SERV only drafted / explained.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
