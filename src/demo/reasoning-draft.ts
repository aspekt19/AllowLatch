/**
 * Policy Copilot smoke: draft_policy via SERV (conflicts / assumptions / questions).
 *
 *   npm run reasoning:draft
 *   npm run reasoning:draft -- "messy mandate text…"
 */
import dotenv from 'dotenv'
dotenv.config()

import { draftPolicyWithServ } from '../llm/compile-mandate.js'

const DEFAULT = `Agent wallet about $200. Maybe $10 per transfer or wait maybe $25? 
$40 a day but weekends can be higher. Only USDC and ETH, Uniswap ok. 
Ask me above $8. No memes. Also allow any address I guess? Wait no, only Uniswap.`

async function main() {
  const mandateText = process.argv.slice(2).join(' ').trim() || DEFAULT

  console.log('=== AllowLatch Policy Copilot · draft_policy ===')
  console.log(mandateText)
  console.log('')

  const { draft, meta } = await draftPolicyWithServ(mandateText)

  console.log('Summary:', draft.summary)
  console.log('Ready to apply:', draft.readyToApply)
  if (draft.conflicts.length) {
    console.log('\nConflicts:')
    for (const c of draft.conflicts) console.log('  •', c)
  }
  if (draft.assumptions.length) {
    console.log('\nAssumptions:')
    for (const a of draft.assumptions) console.log('  •', a)
  }
  if (draft.questions.length) {
    console.log('\nQuestions:')
    for (const q of draft.questions) console.log('  •', q)
  }
  console.log('\nPolicy draft:')
  console.log(JSON.stringify(draft.policy, null, 2))
  console.log(
    `\n[serv] model=${meta.model} prompt=${meta.promptVersion} ${meta.latencyMs}ms tokens=${meta.usage?.totalTokens ?? '?'}`
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
