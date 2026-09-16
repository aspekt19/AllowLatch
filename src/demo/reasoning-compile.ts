/**
 * Test AllowLatch policy compile via SERV Reasoning (no Platform host required).
 *
 * Usage:
 *   SERV_API_KEY=... npm run reasoning:compile -- "Max $10 per tx, $40/day, only ETH and USDC"
 */
import dotenv from 'dotenv'
dotenv.config()

import { compileMandateWithServ } from '../llm/compile-mandate.js'

async function main() {
  const mandateText =
    process.argv.slice(2).join(' ').trim() ||
    'Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap allowed. Ask me above $8.'

  console.log('Compiling via SERV Reasoning…')
  console.log('Mandate:', mandateText)

  const { policy, meta } = await compileMandateWithServ(mandateText)

  console.log(JSON.stringify(policy, null, 2))
  console.log(
    `\nOK — model=${meta.model} prompt=${meta.promptVersion} effort=${meta.reasoningEffort} ${meta.latencyMs}ms tokens=${meta.usage?.totalTokens ?? '?'}`
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
