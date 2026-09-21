/**
 * Cursor agent spender — local EVM wallet + AllowLatch before every USDC transfer.
 *
 * CDP AgentKit live path needs CDP_* in .env. Until then this uses AGENT_PRIVATE_KEY
 * from .env.agent and signs with viem only after evaluateIntent ALLOW + receipt consume.
 *
 *   npx tsx examples/cursor-agent-spender.ts status
 *   npx tsx examples/cursor-agent-spender.ts apply "mandate text..."
 *   npx tsx examples/cursor-agent-spender.ts transfer 0x... 1.5 "reason"
 */
import dotenv from 'dotenv'
dotenv.config()
dotenv.config({ path: '.env.agent', override: false })

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatEther,
  formatUnits,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { erc20Abi } from 'viem'

import { MandatePolicySchema, SpendIntentSchema, type MandatePolicy } from '../src/policy/schema.js'
import { evaluateIntent, commitIntent } from '../src/policy/engine.js'
import { PolicyStore } from '../src/store/fs-store.js'
import { issueAllowReceipt, verifyAllowReceipt } from '../src/billing/receipt.js'
import { compileMandateWithServ, BASE_UNISWAP_UNIVERSAL_ROUTER } from '../src/llm/compile-mandate.js'
import { compileMandateLocally } from '../src/policy/local-compile.js'
import { USDC_BASE, USDC_BASE_SEPOLIA } from '../src/executor/gated-executor.js'

const POLICY_ID = process.env.ALLOWLATCH_POLICY_ID?.trim() || 'cursor-agent-spender'

function networkId(): string {
  return process.env.NETWORK_ID?.trim() || 'base'
}

function chainFor(nid: string) {
  return nid.includes('sepolia') ? baseSepolia : base
}

function usdcFor(nid: string) {
  return nid.includes('sepolia') ? USDC_BASE_SEPOLIA : USDC_BASE
}

function requireAgentKey(): Hex {
  let pk = process.env.AGENT_PRIVATE_KEY?.trim()
  if (!pk) throw new Error('Missing AGENT_PRIVATE_KEY in .env.agent')
  if (!pk.startsWith('0x')) pk = `0x${pk}`
  return pk as Hex
}

async function ensureReceiptSecret() {
  if (!process.env.ALLOWLATCH_RECEIPT_SECRET?.trim() && !process.env.SERV_API_KEY?.trim()) {
    process.env.ALLOWLATCH_RECEIPT_SECRET = 'cursor-agent-dev-receipt-secret'
  }
}

async function status() {
  await ensureReceiptSecret()
  const pk = requireAgentKey()
  const account = privateKeyToAccount(pk)
  const nid = networkId()
  const chain = chainFor(nid)
  const usdc = usdcFor(nid)
  const client = createPublicClient({ chain, transport: http() })
  const eth = await client.getBalance({ address: account.address })
  const bal = await client.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })

  const store = new PolicyStore()
  await store.init()
  const meta = store.getPolicyMeta(POLICY_ID)
  const policy = meta ? store.getPolicy(POLICY_ID) : null

  console.log('=== Cursor agent · AllowLatch spender ===')
  console.log('address:', account.address)
  console.log('network:', nid)
  console.log('ETH:', formatEther(eth))
  console.log('USDC:', formatUnits(bal, 6))
  console.log('policyId:', POLICY_ID)
  if (!policy) {
    console.log('policy: NONE — refuse all spends until owner applies a mandate')
  } else {
    console.log('policy:', policy.name)
    console.log(
      'limits:',
      `maxPerOrder $${policy.capital.maxPerOrderUsd}`,
      `/ day $${policy.capital.maxNotionalUsdPerDay}`,
      `escalate >$${policy.escalation.requireHumanConfirmAboveUsd}`
    )
    console.log('allowedAddresses:', policy.universe.allowedAddresses.length)
  }
  console.log(
    '\nNote: CDP_* not set — signing via local AGENT_PRIVATE_KEY after AllowLatch ALLOW.'
  )
}

async function applyMandate(text: string) {
  await ensureReceiptSecret()
  const nid = networkId()
  console.log('Compiling mandate via AllowLatch…')
  let policy: MandatePolicy
  try {
    const draft = await compileMandateWithServ(text)
    policy = MandatePolicySchema.parse(draft.policy)
    console.log('compiler: SERV')
  } catch (err) {
    console.log('compiler: local fallback —', err instanceof Error ? err.message.slice(0, 120) : err)
    policy = MandatePolicySchema.parse(compileMandateLocally(text))
  }
  // Keep Uniswap router allowlisted when mandate mentions swaps / Uniswap.
  if (
    /uniswap|swap/i.test(text) &&
    !policy.universe.allowedAddresses.map((a) => a.toLowerCase()).includes(BASE_UNISWAP_UNIVERSAL_ROUTER.toLowerCase())
  ) {
    policy = {
      ...policy,
      universe: {
        ...policy.universe,
        allowedAddresses: [...policy.universe.allowedAddresses, BASE_UNISWAP_UNIVERSAL_ROUTER],
      },
    }
  }
  policy = {
    ...policy,
    chain: nid.includes('sepolia') ? 'base-sepolia' : 'base',
    currency: 'USDC',
  }

  const store = new PolicyStore()
  await store.init()
  await store.setPolicy(POLICY_ID, policy, 'cursor-owner')
  console.log('Applied policy:', policy.name)
  console.log(JSON.stringify(policy, null, 2))
}

async function transfer(to: string, amountUsd: number, reason: string) {
  await ensureReceiptSecret()
  const pk = requireAgentKey()
  const account = privateKeyToAccount(pk)
  const nid = networkId()
  const chain = chainFor(nid)
  const usdc = usdcFor(nid)

  const store = new PolicyStore()
  await store.init()
  if (!store.getPolicyMeta(POLICY_ID)) {
    throw new Error(
      'AllowLatch DENY (fail-closed): no policy. Owner must apply a mandate first (apply <text>).'
    )
  }
  const policy = store.getPolicy(POLICY_ID)

  const intent = SpendIntentSchema.parse({
    action: 'transfer',
    amountUsd,
    symbol: 'USDC',
    toAddress: to,
    reason,
    networkId: policy.chain,
  })

  console.log('Spender proposes → AllowLatch')
  console.log(`  $${amountUsd} USDC → ${to}`)
  console.log(`  reason: ${reason}`)

  const ledger = store.getLedger(POLICY_ID)
  const evaluation = evaluateIntent(policy, intent, ledger)
  console.log(`AllowLatch: ${evaluation.decision.toUpperCase()}`)
  for (const r of evaluation.reasons) console.log(`  • ${r}`)

  if (evaluation.decision !== 'allow') {
    throw new Error(`Blocked: ${evaluation.decision} — not signing`)
  }

  const receipt = issueAllowReceipt({ policyId: POLICY_ID, policy, intent, evaluation })
  const verified = verifyAllowReceipt(receipt, { policy, intent })
  if (!verified.ok) throw new Error(`Invalid receipt: ${verified.error}`)
  const consumed = store.tryConsumeReceipt(receipt.jti, {
    policyId: POLICY_ID,
    intentHash: receipt.intentHash,
  })
  if (!consumed) throw new Error('Receipt already consumed')

  const client = createPublicClient({ chain, transport: http() })
  const wallet = createWalletClient({ account, chain, transport: http() })
  const amount = parseUnits(String(amountUsd), 6)
  const hash = await wallet.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to as `0x${string}`, amount],
  })
  console.log('TX submitted:', hash)
  await client.waitForTransactionReceipt({ hash })
  await store.setLedger(POLICY_ID, commitIntent(ledger, intent))
  console.log('EXECUTED after AllowLatch ALLOW + consumed receipt')
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === 'status') {
    await status()
    return
  }
  if (cmd === 'apply') {
    const text = rest.join(' ').trim()
    if (!text) throw new Error('Usage: apply "<mandate text>"')
    await applyMandate(text)
    return
  }
  if (cmd === 'transfer') {
    const [to, amountStr, ...reasonParts] = rest
    const amount = Number(amountStr)
    if (!to || !Number.isFinite(amount)) {
      throw new Error('Usage: transfer <0xTo> <usd> [reason...]')
    }
    await transfer(to, amount, reasonParts.join(' ') || 'agent transfer')
    return
  }
  throw new Error(`Unknown command: ${cmd}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
