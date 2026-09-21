/**
 * Finish live path: paid assertSpend ALLOW → Base USDC transfer.
 * Assumes policy already on host (policyId below) and gate online.
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
import { assertSpend } from '../src/sdk/assert-spend.js'
import { USDC_BASE } from '../src/executor/gated-executor.js'

const DEST = '0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205' as const
const OPERATOR = '0xa91841F98fd15e3f590e2681d7122ec04bc7F677' as const
const POLICY_ID = process.env.ALLOWLATCH_LIVE_POLICY_ID?.trim() || 'live-user-1789989621807'
const TRIGGER =
  process.env.ALLOWLATCH_TRIGGER_URL?.trim() ||
  'https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53'
const AMOUNT = 0.04

function requireAgentKey(): Hex {
  let pk = process.env.AGENT_PRIVATE_KEY?.trim()
  if (!pk) throw new Error('AGENT_PRIVATE_KEY missing')
  if (!pk.startsWith('0x')) pk = `0x${pk}`
  return pk as Hex
}

async function bal(address: `0x${string}`) {
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.RPC_URL || 'https://mainnet.base.org'),
  })
  return {
    eth: formatEther(await client.getBalance({ address })),
    usdc: formatUnits(
      await client.readContract({
        address: USDC_BASE,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      }),
      6
    ),
  }
}

async function main() {
  const payerKey = requireAgentKey()
  const agent = privateKeyToAccount(payerKey)
  console.log('=== FINISH LIVE · assertSpend → transfer ===')
  console.log('policyId', POLICY_ID)
  console.log('before agent', await bal(agent.address))
  console.log('before operator', await bal(OPERATOR))

  const intent = {
    action: 'transfer' as const,
    amountUsd: AMOUNT,
    symbol: 'USDC',
    tokenAddress: USDC_BASE,
    toAddress: DEST,
    chainId: 8453,
    networkId: 'base',
    reason: 'finish live user path',
  }

  console.log('\n→ x402 assertSpend ($0.025)…')
  const allowed = await assertSpend({
    triggerUrl: TRIGGER,
    walletPrivateKey: payerKey,
    policyId: POLICY_ID,
    intent,
    requireReceipt: true,
  })
  console.log('decision', allowed.decision, 'jti', allowed.receipt?.jti)

  const rpc = process.env.RPC_URL || 'https://mainnet.base.org'
  const publicClient = createPublicClient({ chain: base, transport: http(rpc) })
  const wallet = createWalletClient({
    account: privateKeyToAccount(payerKey),
    chain: base,
    transport: http(rpc),
  })
  console.log('\n→ Sign transfer after paid ALLOW + receipt…')
  const hash = await wallet.writeContract({
    address: USDC_BASE,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [DEST, parseUnits(String(AMOUNT), 6)],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('EXECUTED', hash)
  console.log(`https://basescan.org/tx/${hash}`)
  console.log('after agent', await bal(agent.address))
  console.log('after operator', await bal(OPERATOR))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
