/**
 * Real battle: Spender agent proposes spends → SpendGate evaluates → AgentKit executes only on ALLOW.
 *
 * Dry-run (no CDP): policy + gate still real; tx is simulated.
 * Live: set CDP_* + NETWORK_ID=base-sepolia + fund wallet with test USDC.
 *
 *   npm run battle
 *   npm run battle -- --live   # forces live if CDP configured
 */
import dotenv from 'dotenv'
dotenv.config()

import { MandatePolicySchema, type SpendIntent } from '../policy/schema.js'
import { PolicyStore } from '../store/fs-store.js'
import { gatedTransfer, resolveExecuteMode } from '../executor/gated-executor.js'
import { servStructured } from '../llm/serv-reasoning.js'

const UNISWAP = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'
const POLICY_ID = 'battle'

const DEFAULT_MANDATE =
  'Agent wallet $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap router allowed. Ask me above $8. No meme coins.'

function parseArgs(argv: string[]) {
  const live = argv.includes('--live')
  const rest = argv.filter((a) => a !== '--live')
  return { live, mandateText: rest.join(' ').trim() || DEFAULT_MANDATE }
}

async function propose(
  store: PolicyStore,
  label: string,
  intent: SpendIntent,
  humanApproved = false
) {
  console.log(`\n── Spender proposes: ${label}`)
  console.log(
    `   ${intent.action} $${intent.amountUsd}` +
      (intent.symbol ? ` ${intent.symbol}` : '') +
      (intent.toAddress ? `\n   → ${intent.toAddress}` : '')
  )

  const result = await gatedTransfer(store, {
    policyId: POLICY_ID,
    intent,
    humanApproved,
  })

  console.log(`── SpendGate: ${result.evaluation.decision.toUpperCase()}  [${result.mode}]`)
  for (const r of result.evaluation.reasons) console.log(`   • ${r}`)
  console.log(`── ${result.executed ? 'EXECUTED' : 'BLOCKED'}: ${result.message}`)
  if (result.txHash) console.log(`── tx: ${result.txHash}`)
  if (result.walletAddress) console.log(`── spender wallet: ${result.walletAddress}`)
  return result
}

async function main() {
  const { live, mandateText } = parseArgs(process.argv.slice(2))
  if (live) process.env.SPENDGATE_EXECUTE_MODE = 'live'

  const mode = resolveExecuteMode()
  console.log('=== SpendGate BATTLE ===')
  console.log(`Execute mode: ${mode}`)
  if (mode === 'dry-run') {
    console.log(
      'No CDP keys (or dry-run forced): gate is real, AgentKit tx is simulated.\n' +
        'For live Base Sepolia: set CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET in .env\n' +
        'See docs/BATTLE.md'
    )
  }

  const store = new PolicyStore()
  await store.init()

  console.log('\n=== Owner → SpendGate: compile mandate (SERV Reasoning) ===')
  console.log(mandateText)

  const policy = await servStructured({
    system:
      'You are SpendGate policy compiler. Output only valid structured MandatePolicy JSON for Base/USDC agent wallets. Be conservative.',
    user: `Convert this mandate into MandatePolicy for Base USDC.

"""
${mandateText}
"""

version "1.0", chain "base", currency "USDC".
Defaults if missing: maxPerOrderUsd 10, maxNotionalUsdPerDay 40, maxTransactionsPerHour 20, agentWalletBudgetUsd 200.
If Uniswap mentioned, allow ${UNISWAP}.
If meme/PEPE denied, put PEPE in deniedSymbols.
Escalation threshold slightly below maxPerOrder when "ask above $X".`,
    schema: MandatePolicySchema,
    schemaName: 'mandate_policy',
  })

  // Optional battle destination (your second wallet) — auto-allowlist for live transfers
  const dest = process.env.BATTLE_DESTINATION_ADDRESS
  if (dest?.startsWith('0x') && dest.length === 42) {
    if (!policy.universe.allowedAddresses.map((a) => a.toLowerCase()).includes(dest.toLowerCase())) {
      policy.universe.allowedAddresses.push(dest)
    }
  }

  await store.setPolicy(POLICY_ID, policy)
  console.log('Policy stored under id "battle":')
  console.log(JSON.stringify(policy, null, 2))

  // 1) Happy path — small transfer to allowlisted address
  const okTo = dest && dest.startsWith('0x') ? dest : UNISWAP
  await propose(store, 'OK small transfer', {
    action: 'transfer',
    amountUsd: 1,
    toAddress: okTo,
    reason: 'Battle smoke transfer',
  })

  // 2) Deny — meme
  await propose(store, 'YOLO PEPE', {
    action: 'swap',
    amountUsd: 5,
    symbol: 'PEPE',
    toAddress: UNISWAP,
    reason: 'meme',
  })

  // 3) Deny — over cap
  await propose(store, 'Huge transfer', {
    action: 'transfer',
    amountUsd: 50,
    toAddress: okTo,
    reason: 'too much',
  })

  // 4) Escalate then human approve
  const escalateAmount = Math.min(
    policy.capital.maxPerOrderUsd,
    Number((policy.escalation.requireHumanConfirmAboveUsd + 0.5).toFixed(2))
  )
  if (escalateAmount > policy.escalation.requireHumanConfirmAboveUsd) {
    await propose(store, 'Needs human', {
      action: 'transfer',
      amountUsd: escalateAmount,
      toAddress: okTo,
      reason: 'above confirm threshold',
    })
    console.log('\n── Owner approves escalation…')
    await propose(
      store,
      'Needs human (after owner yes)',
      {
        action: 'transfer',
        amountUsd: escalateAmount,
        toAddress: okTo,
        reason: 'above confirm threshold',
      },
      true
    )
  }

  // 5) Deny — random address
  await propose(store, 'Wrong address', {
    action: 'transfer',
    amountUsd: 2,
    toAddress: '0x000000000000000000000000000000000000dEaD',
    reason: 'typo',
  })

  console.log('\n=== Battle complete ===')
  console.log('Flow: Owner mandate → SpendGate policy → Spender asks → gate → AgentKit only on ALLOW')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
