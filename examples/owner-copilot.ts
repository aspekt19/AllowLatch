/**
 * Owner-side Policy Copilot demo.
 *
 * Uses *your* SERV_API_KEY (one explicit OpenServ Reasoning console step).
 * Never sends that key to the AllowLatch host.
 *
 *   npm run owner:copilot
 *   npm run owner:copilot -- "max $10/tx, $40/day, USDC+ETH, Uniswap, ask above $8"
 *
 * Prints a draft + the exact gate apply_policy prompt for x402.
 */
import dotenv from 'dotenv'
dotenv.config()

import {
  gateApplyPrompt,
  ownerDraftPolicy,
  ownerRevisePolicy,
} from '../src/owner/copilot.js'

const MANDATE =
  process.argv.slice(2).join(' ').trim() ||
  `Agent wallet $200 on Base. Max $10 per transfer, $40 per day.
Only USDC and ETH. Uniswap allowed. Ask me above $8. No meme coins.`

async function main() {
  if (!process.env.SERV_API_KEY?.trim()) {
    console.error(
      'Missing SERV_API_KEY.\n' +
        'One-time: create an OpenServ Reasoning key in the console and put it in this agent\'s .env.\n' +
        'AllowLatch host never stores your key.'
    )
    process.exit(1)
  }

  console.log('=== Owner-side Policy Copilot ===\n')
  console.log('Mandate:\n', MANDATE, '\n')

  let { draft, meta } = await ownerDraftPolicy(MANDATE)
  console.log('Summary:', draft.summary)
  console.log('Ready to apply:', draft.readyToApply)
  for (const c of draft.conflicts) console.log('  conflict ·', c)
  for (const a of draft.assumptions) console.log('  assume  ·', a)
  for (const q of draft.questions) console.log('  ask     ·', q)
  console.log(`[serv] draft ${meta.latencyMs}ms model=${meta.model}\n`)

  if (!draft.readyToApply) {
    console.log('Revising with conservative clarifications…\n')
    ;({ draft, meta } = await ownerRevisePolicy({
      currentPolicy: draft.policy,
      revisionText:
        'Confirm $10 max per transfer, $40 every day, Uniswap destinations only, ask above $8.',
    }))
    console.log('Revised summary:', draft.summary)
    console.log('Ready to apply:', draft.readyToApply)
    console.log(`[serv] revise ${meta.latencyMs}ms\n`)
  }

  console.log('Policy JSON:\n', JSON.stringify(draft.policy, null, 2), '\n')
  console.log('--- Send this to AllowLatch gate (x402), not your SERV key ---\n')
  console.log(gateApplyPrompt({ policy: draft.policy }))
  console.log(
    '\nThen: evaluate_intent / execute_gated_transfer on the host before any AgentKit spend.'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
