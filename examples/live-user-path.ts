/**
 * Fully live user-path E2E: OpenServ x402 → AllowLatch Gate → receipt → Base USDC transfer.
 *
 * Payer = AGENT_PRIVATE_KEY (agent wallet USDC pays $0.025/call).
 * Fees settle to OpenServ service owner (operator 0xa918…).
 *
 * Prerequisite: hosted gate online (`npm run dev` or deploy:host), agent funded with USDC+ETH.
 */
import dotenv from 'dotenv'
dotenv.config()
dotenv.config({ path: '.env.agent', override: false })

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  formatEther,
  erc20Abi,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { PlatformClient } from '@openserv-labs/client'
import { assertSpend } from '../src/sdk/assert-spend.js'
import { USDC_BASE } from '../src/executor/gated-executor.js'

const DEST = '0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205'
const POLICY_ID = `live-user-${Date.now()}`
const TRIGGER =
  process.env.ALLOWLATCH_TRIGGER_URL?.trim() ||
  'https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53'

const MANDATE = `Бюджет агента $0.16 USDC на Base. Макс $0.10 за перевод. Эскалация выше $0.05. Разрешён только перевод на ${DEST}. Без свапов и сторонних контрактов.`

function requireAgentKey(): Hex {
  let pk = process.env.AGENT_PRIVATE_KEY?.trim()
  if (!pk) throw new Error('AGENT_PRIVATE_KEY missing in .env.agent')
  if (!pk.startsWith('0x')) pk = `0x${pk}`
  return pk as Hex
}

async function balances(label: string, addresses: { name: string; address: `0x${string}` }[]) {
  const client = createPublicClient({ chain: base, transport: http() })
  console.log(`\n=== balances · ${label} ===`)
  for (const a of addresses) {
    const eth = await client.getBalance({ address: a.address })
    const usdc = await client.readContract({
      address: USDC_BASE,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [a.address],
    })
    console.log(
      `${a.name} ${a.address}: ${formatEther(eth)} ETH · ${formatUnits(usdc, 6)} USDC`
    )
  }
}

async function payPrompt(payerKey: string, prompt: string) {
  const client = new PlatformClient()
  console.log('\n→ x402 payWorkflow ($0.025)…')
  console.log(prompt.slice(0, 180) + (prompt.length > 180 ? '…' : ''))
  const raw = await client.payments.payWorkflow({
    triggerUrl: TRIGGER,
    input: { prompt },
    privateKey: payerKey,
  })
  const paid = raw as { response?: unknown }
  const payload = paid.response ?? raw
  console.log('← response:', typeof payload === 'string' ? payload.slice(0, 800) : JSON.stringify(payload).slice(0, 800))
  return payload
}

async function transferUsdc(pk: Hex, to: `0x${string}`, amountUsd: number) {
  const account = privateKeyToAccount(pk)
  const publicClient = createPublicClient({ chain: base, transport: http() })
  const wallet = createWalletClient({ account, chain: base, transport: http() })
  const hash = await wallet.writeContract({
    address: USDC_BASE,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, parseUnits(String(amountUsd), 6)],
  })
  console.log('TX submitted', hash)
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

async function main() {
  const payerKey = requireAgentKey()
  const agent = privateKeyToAccount(payerKey)
  const operator = '0xa91841F98fd15e3f590e2681d7122ec04bc7F677' as const

  console.log('=== FULL LIVE USER PATH ===')
  console.log('policyId:', POLICY_ID)
  console.log('trigger:', TRIGGER)
  console.log('x402 payer / spender:', agent.address)
  console.log('fee receiver (OpenServ owner):', operator)

  await balances('before', [
    { name: 'agent', address: agent.address },
    { name: 'operator', address: operator },
  ])

  // 1) Apply mandate via paid OpenServ call
  await payPrompt(
    payerKey,
    [
      `compile_mandate and store for policyId=${POLICY_ID} with ownerId=live-owner.`,
      'Mandate:',
      MANDATE,
      'Return the stored policy JSON summary (capital, escalation, allowedAddresses, actions).',
    ].join('\n')
  )

  // 2) DENY path — paid evaluate, no sign
  console.log('\n=== assertSpend DENY (wrong destination) ===')
  try {
    await assertSpend({
      triggerUrl: TRIGGER,
      walletPrivateKey: payerKey,
      policyId: POLICY_ID,
      intent: {
        action: 'transfer',
        amountUsd: 0.04,
        symbol: 'USDC',
        toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
        networkId: 'base',
        reason: 'live deny test',
      },
      requireReceipt: true,
    })
    console.error('UNEXPECTED: deny path returned ALLOW')
  } catch (err) {
    console.log('blocked (expected):', err instanceof Error ? err.message.slice(0, 240) : err)
  }

  // 3) ALLOW path — paid evaluate + receipt, then sign
  console.log('\n=== assertSpend ALLOW ($0.04) ===')
  const allowed = await assertSpend({
    triggerUrl: TRIGGER,
    walletPrivateKey: payerKey,
    policyId: POLICY_ID,
    intent: {
      action: 'transfer',
      amountUsd: 0.04,
      symbol: 'USDC',
      toAddress: DEST,
      networkId: 'base',
      reason: 'live allow test',
    },
    requireReceipt: true,
  })
  console.log('decision:', allowed.decision)
  console.log('receipt jti:', allowed.receipt?.jti)

  console.log('\n=== Sign Base USDC transfer only after paid ALLOW + receipt ===')
  const tx = await transferUsdc(payerKey, DEST, 0.04)
  console.log('EXECUTED', tx)
  console.log(`basescan: https://basescan.org/tx/${tx}`)

  await balances('after', [
    { name: 'agent', address: agent.address },
    { name: 'operator', address: operator },
  ])

  console.log('\nDone. Operator USDC should have increased by ~$0.05–0.075 (2–3 × $0.025 x402).')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
