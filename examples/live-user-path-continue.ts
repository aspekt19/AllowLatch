/**
 * Continue full live user path after x402 fees already hit the operator wallet.
 *
 * Needs agent USDC ≥ ~0.10 (one evaluate $0.025 + transfer $0.04 + buffer).
 * Host must be online (`npm run dev`).
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

const DEST = '0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205' as const
const OPERATOR = '0xa91841F98fd15e3f590e2681d7122ec04bc7F677' as const
const POLICY_ID = process.env.ALLOWLATCH_LIVE_POLICY_ID?.trim() || `live-user-${Date.now()}`
const TRIGGER =
  process.env.ALLOWLATCH_TRIGGER_URL?.trim() ||
  'https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53'
const AMOUNT = Number(process.env.LIVE_TRANSFER_USD || '0.04')

function requireAgentKey(): Hex {
  let pk = process.env.AGENT_PRIVATE_KEY?.trim()
  if (!pk) throw new Error('AGENT_PRIVATE_KEY missing')
  if (!pk.startsWith('0x')) pk = `0x${pk}`
  return pk as Hex
}

async function bal(rpc: string, address: `0x${string}`) {
  const client = createPublicClient({ chain: base, transport: http(rpc) })
  const eth = await client.getBalance({ address })
  const usdc = await client.readContract({
    address: USDC_BASE,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  })
  return { eth: formatEther(eth), usdc: formatUnits(usdc, 6) }
}

async function main() {
  const payerKey = requireAgentKey()
  const agent = privateKeyToAccount(payerKey)
  const rpc = process.env.RPC_URL?.trim() || 'https://mainnet.base.org'

  console.log('=== LIVE CONTINUE · paid gate → sign ===')
  console.log('policyId', POLICY_ID)
  console.log('agent', agent.address)
  console.log('operator', OPERATOR)

  const beforeAgent = await bal(rpc, agent.address)
  const beforeOp = await bal(rpc, OPERATOR)
  console.log('before agent', beforeAgent)
  console.log('before operator', beforeOp)

  const usdcNum = Number(beforeAgent.usdc)
  if (usdcNum < 0.025 + AMOUNT) {
    throw new Error(
      `Agent USDC ${beforeAgent.usdc} too low. Need ≥ ${(0.025 + AMOUNT).toFixed(3)} ` +
        `(evaluate $0.025 + transfer $${AMOUNT}). Top up ${agent.address} on Base.`
    )
  }

  const policy = {
    version: '1.0',
    name: 'Live user path',
    chain: 'base',
    currency: 'USDC',
    capital: {
      agentWalletBudgetUsd: 1,
      maxNotionalUsdPerDay: 1,
      maxPerOrderUsd: 0.1,
      maxTransactionsPerHour: 20,
    },
    universe: {
      allowedSymbols: ['USDC'],
      deniedSymbols: [],
      allowedAddresses: [DEST],
      deniedAddresses: [],
      allowedContracts: [],
      deniedContracts: [],
      allowedTokenAddresses: [],
      deniedTokenAddresses: [],
      allowedFunctionSelectors: [],
      deniedFunctionSelectors: [],
    },
    actions: { allowSwap: false, allowTransfer: true, allowX402Pay: false },
    risk: { emergencyStop: false },
    escalation: { requireHumanConfirmAboveUsd: 0.05 },
  }

  const client = new PlatformClient()
  console.log('\n→ x402 apply_policy ($0.025)…')
  const applyRaw = await client.payments.payWorkflow({
    triggerUrl: TRIGGER,
    privateKey: payerKey,
    input: {
      prompt: [
        `Call apply_policy ONLY.`,
        `policyId=${POLICY_ID}`,
        `ownerId=live-owner`,
        `policy JSON:`,
        JSON.stringify(policy),
        `Return JSON { ok, policyId, capital, escalation, allowedAddresses }.`,
      ].join('\n'),
    },
  })
  console.log('apply settle →', JSON.stringify((applyRaw as { response?: { settleTxHash?: string; payToAddress?: string } })?.response ?? {}).slice(0, 200))

  const intent = {
    action: 'transfer' as const,
    amountUsd: AMOUNT,
    symbol: 'USDC',
    tokenAddress: USDC_BASE,
    toAddress: DEST,
    chainId: 8453,
    networkId: 'base',
    reason: 'full live user-path allow',
  }

  console.log('\n→ x402 assertSpend ALLOW ($0.025)…')
  const allowed = await assertSpend({
    triggerUrl: TRIGGER,
    walletPrivateKey: payerKey,
    policyId: POLICY_ID,
    intent,
    requireReceipt: true,
  })
  console.log('decision', allowed.decision, 'jti', allowed.receipt?.jti)

  console.log('\n→ Sign USDC transfer (only after paid ALLOW + receipt)…')
  const publicClient = createPublicClient({ chain: base, transport: http(rpc) })
  const wallet = createWalletClient({
    account: privateKeyToAccount(payerKey),
    chain: base,
    transport: http(rpc),
  })
  const hash = await wallet.writeContract({
    address: USDC_BASE,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [DEST, parseUnits(String(AMOUNT), 6)],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('EXECUTED', hash)
  console.log(`https://basescan.org/tx/${hash}`)

  console.log('\nafter agent', await bal(rpc, agent.address))
  console.log('after operator', await bal(rpc, OPERATOR))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
