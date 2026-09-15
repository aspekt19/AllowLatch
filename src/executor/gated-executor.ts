/**
 * Gated executor: SpendGate decide → only then AgentKit may move USDC on Base.
 * Without CDP credentials → dry-run (policy still enforced).
 */

import {
  AgentKit,
  CdpEvmWalletProvider,
  erc20ActionProvider,
  walletActionProvider,
} from '@coinbase/agentkit'
import type { EvaluationResult, SpendIntent } from '../policy/schema.js'
import { commitIntent, evaluateIntent } from '../policy/engine.js'
import type { PolicyStore } from '../store/fs-store.js'

/** USDC on Base mainnet */
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
/** USDC on Base Sepolia */
export const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const

export type ExecuteMode = 'dry-run' | 'live'

type KitBundle = {
  kit: AgentKit
  walletAddress: string
  networkId: string
}

let kitBundle: Promise<KitBundle> | null = null

export function resolveExecuteMode(): ExecuteMode {
  const forced = process.env.SPENDGATE_EXECUTE_MODE || process.env.MANDATEGUARD_EXECUTE_MODE
  if (forced === 'dry-run' || forced === 'live') return forced
  const hasCdp =
    !!process.env.CDP_API_KEY_ID &&
    !!process.env.CDP_API_KEY_SECRET &&
    !!process.env.CDP_WALLET_SECRET
  return hasCdp ? 'live' : 'dry-run'
}

export function usdcAddressForNetwork(networkId: string): `0x${string}` {
  if (networkId.includes('sepolia')) return USDC_BASE_SEPOLIA
  return USDC_BASE
}

async function getKitBundle(): Promise<KitBundle> {
  if (!kitBundle) {
    kitBundle = (async () => {
      const networkId = process.env.NETWORK_ID || 'base-sepolia'
      const walletProvider = await CdpEvmWalletProvider.configureWithWallet({
        apiKeyId: process.env.CDP_API_KEY_ID!,
        apiKeySecret: process.env.CDP_API_KEY_SECRET!,
        walletSecret: process.env.CDP_WALLET_SECRET!,
        networkId,
        address: process.env.CDP_WALLET_ADDRESS as `0x${string}` | undefined,
      })
      const kit = await AgentKit.from({
        walletProvider,
        actionProviders: [walletActionProvider(), erc20ActionProvider()],
      })
      return { kit, walletAddress: walletProvider.getAddress(), networkId }
    })()
  }
  return kitBundle
}

export type GatedTransferInput = {
  policyId: string
  intent: SpendIntent
  humanApproved?: boolean
}

export type GatedTransferResult = {
  mode: ExecuteMode
  evaluation: EvaluationResult
  executed: boolean
  txHash?: string
  walletAddress?: string
  message: string
}

/**
 * Evaluate policy, then optionally transfer USDC via AgentKit.
 * v1 executes transfer / x402_pay with toAddress. Swaps: evaluate only.
 */
export async function gatedTransfer(
  store: PolicyStore,
  input: GatedTransferInput
): Promise<GatedTransferResult> {
  const policy = store.getPolicy(input.policyId)
  const ledger = store.getLedger(input.policyId)
  let evaluation = evaluateIntent(policy, input.intent, ledger)

  if (evaluation.decision === 'escalate' && input.humanApproved) {
    evaluation = {
      ...evaluation,
      decision: 'allow',
      reasons: [
        ...evaluation.reasons,
        'Human approved escalation; treating as ALLOW for this execution.',
      ],
    }
  }

  if (evaluation.decision === 'deny') {
    return {
      mode: resolveExecuteMode(),
      evaluation,
      executed: false,
      message: 'Blocked by SpendGate. No transaction sent.',
    }
  }

  if (evaluation.decision === 'escalate') {
    return {
      mode: resolveExecuteMode(),
      evaluation,
      executed: false,
      message: 'Needs human confirmation. Re-call with humanApproved=true to proceed.',
    }
  }

  if (input.intent.action === 'swap') {
    return {
      mode: resolveExecuteMode(),
      evaluation,
      executed: false,
      message:
        'Policy ALLOW for swap, but swap execution is not wired in v1. Execute swap externally after ALLOW, or use transfer/x402_pay.',
    }
  }

  if (!input.intent.toAddress) {
    return {
      mode: resolveExecuteMode(),
      evaluation,
      executed: false,
      message: 'ALLOW, but toAddress is required to execute a transfer.',
    }
  }

  const mode = resolveExecuteMode()

  if (mode === 'dry-run') {
    await store.setLedger(input.policyId, commitIntent(ledger, input.intent))
    return {
      mode,
      evaluation,
      executed: true,
      message: `DRY-RUN: would transfer $${input.intent.amountUsd} USDC to ${input.intent.toAddress}. Ledger updated. Set CDP_* + SPENDGATE_EXECUTE_MODE=live for real Base tx.`,
    }
  }

  const { kit, walletAddress, networkId } = await getKitBundle()
  const tokenAddress = usdcAddressForNetwork(networkId)
  const transfer = kit.getActions().find((a) => a.name === 'transfer')
  if (!transfer) {
    throw new Error('AgentKit transfer action not available')
  }

  const result = await transfer.invoke({
    amount: String(input.intent.amountUsd),
    tokenAddress,
    destinationAddress: input.intent.toAddress,
  })

  await store.setLedger(input.policyId, commitIntent(ledger, input.intent))

  const txHash = result.match(/0x[a-fA-F0-9]{64}/)?.[0]

  return {
    mode,
    evaluation,
    executed: true,
    txHash,
    walletAddress,
    message: result,
  }
}
