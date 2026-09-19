/**
 * Gated executor: evaluate → require action-bound allow-receipt → consume jti → AgentKit.
 * Never signs without a verified, unconsumed receipt (or escalate+humanApproved mint+consume).
 *
 * AgentKit is loaded lazily so the OpenServ host can run evaluate/draft without installing
 * the heavy CDP stack (needed for slim always-on cloud containers).
 */

import type { EvaluationResult, SpendIntent } from '../policy/schema.js'
import { commitIntent, evaluateIntent } from '../policy/engine.js'
import type { PolicyStore } from '../store/fs-store.js'
import {
  issueAllowReceipt,
  parseAllowReceipt,
  verifyAllowReceipt,
  type AllowReceipt,
} from '../billing/receipt.js'
import {
  requiresSyncedPermission,
  resolveEnforcementMode,
} from '../wallet/spend-permissions.js'

/** USDC on Base mainnet */
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
/** USDC on Base Sepolia */
export const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const

export type ExecuteMode = 'dry-run' | 'live'

type AgentKitLike = {
  getActions: () => Array<{ name: string; invoke: (args: Record<string, string>) => Promise<unknown> }>
}

type KitBundle = {
  kit: AgentKitLike
  walletAddress: string
  networkId: string
}

let kitBundle: Promise<KitBundle> | null = null

async function loadAgentKit() {
  const {
    AgentKit,
    CdpEvmWalletProvider,
    cdpEvmWalletActionProvider,
    erc20ActionProvider,
    walletActionProvider,
  } = await import('@coinbase/agentkit')
  return {
    AgentKit,
    CdpEvmWalletProvider,
    cdpEvmWalletActionProvider,
    erc20ActionProvider,
    walletActionProvider,
  }
}

export function resolveExecuteMode(): ExecuteMode {
  const forced = process.env.ALLOWLATCH_EXECUTE_MODE
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
      let mod: Awaited<ReturnType<typeof loadAgentKit>>
      try {
        mod = await loadAgentKit()
      } catch (err) {
        throw new Error(
          `AgentKit not installed on this host (live execute unavailable): ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
      const {
        AgentKit,
        CdpEvmWalletProvider,
        cdpEvmWalletActionProvider,
        erc20ActionProvider,
        walletActionProvider,
      } = mod
      const networkId = process.env.NETWORK_ID || 'base-sepolia'
      const walletProvider = await CdpEvmWalletProvider.configureWithWallet({
        apiKeyId: process.env.CDP_API_KEY_ID!,
        apiKeySecret: process.env.CDP_API_KEY_SECRET!,
        walletSecret: process.env.CDP_WALLET_SECRET!,
        networkId,
        address: process.env.CDP_WALLET_ADDRESS as `0x${string}` | undefined,
      })
      const kit = (await AgentKit.from({
        walletProvider,
        actionProviders: [
          walletActionProvider(),
          erc20ActionProvider(),
          cdpEvmWalletActionProvider(),
        ],
      })) as AgentKitLike
      return { kit, walletAddress: walletProvider.getAddress(), networkId }
    })()
  }
  return kitBundle
}

export type GatedTransferInput = {
  policyId: string
  intent: SpendIntent
  humanApproved?: boolean
  /** Required for ALLOW path (from evaluate_intent). Minted internally for escalate+humanApproved. */
  receipt?: AllowReceipt | Record<string, unknown>
  /** Idempotency key — replays return the same result without double-spend. */
  requestId?: string
}

export type GatedTransferResult = {
  mode: ExecuteMode
  evaluation: EvaluationResult
  executed: boolean
  txHash?: string
  walletAddress?: string
  message: string
  receiptConsumed?: boolean
  requestId?: string
}

/**
 * Evaluate policy, require/consume allow-receipt, then optionally transfer USDC via AgentKit.
 * v1 executes transfer / x402_pay with toAddress. Swaps: policy may ALLOW + receipt for external
 * execution; host executor never submits swaps.
 */
export async function gatedTransfer(
  store: PolicyStore,
  input: GatedTransferInput
): Promise<GatedTransferResult> {
  const requestId =
    input.requestId ?? input.intent.requestId ?? `exec-${input.policyId}-${Date.now()}`

  return store.exclusive(async () => {
    const cached = store.getIdempotentResult(requestId)
    if (cached) {
      return JSON.parse(cached) as GatedTransferResult
    }

    const policy = store.getPolicy(input.policyId)
    const ledger = store.getLedger(input.policyId)
    let evaluation = evaluateIntent(policy, input.intent, ledger)

    await store.audit({
      type: 'intent.evaluated',
      policyId: input.policyId,
      requestId,
      payload: {
        decision: evaluation.decision,
        amountUsd: input.intent.amountUsd,
        action: input.intent.action,
      },
    })

    if (evaluation.decision === 'escalate' && input.humanApproved) {
      evaluation = {
        ...evaluation,
        decision: 'allow',
        reasons: [
          ...evaluation.reasons,
          'Human approved escalation; treating as ALLOW for this execution.',
        ],
      }
      await store.audit({
        type: 'human.approved',
        policyId: input.policyId,
        requestId,
        payload: { amountUsd: input.intent.amountUsd },
      })
    }

    if (evaluation.decision === 'deny') {
      return {
        mode: resolveExecuteMode(),
        evaluation,
        executed: false,
        message: 'Blocked by AllowLatch. No transaction sent.',
        requestId,
      }
    }

    if (evaluation.decision === 'escalate') {
      return {
        mode: resolveExecuteMode(),
        evaluation,
        executed: false,
        message:
          'Needs human confirmation. Re-call with humanApproved=true (mints+consumes receipt) or pass a fresh allow-receipt.',
        requestId,
      }
    }

    // Host executor does not submit swaps — keep receipt usable for external routers.
    if (input.intent.action === 'swap') {
      return {
        mode: resolveExecuteMode(),
        evaluation,
        executed: false,
        message:
          'Swap execution is not wired in the host executor (v1). Call evaluate_intent, keep the allow-receipt, and submit the swap via your own router/AgentKit path after verifyAllowReceipt.',
        requestId,
      }
    }

    if (!input.intent.toAddress) {
      return {
        mode: resolveExecuteMode(),
        evaluation,
        executed: false,
        message: 'ALLOW, but toAddress is required to execute a transfer.',
        requestId,
      }
    }

    // ALLOW path: receipt required (mint if escalate was human-approved without client receipt)
    let receipt = parseAllowReceipt(input.receipt)
    if (!receipt && input.humanApproved) {
      receipt = issueAllowReceipt({
        policyId: input.policyId,
        policy,
        intent: input.intent,
        evaluation,
      })
    }
    if (!receipt) {
      return {
        mode: resolveExecuteMode(),
        evaluation,
        executed: false,
        message:
          'ALLOW requires a valid allow-receipt from evaluate_intent. Call evaluate first, then pass receipt into execute_gated_transfer.',
        requestId,
      }
    }
    if (receipt.policyId !== input.policyId) {
      return {
        mode: resolveExecuteMode(),
        evaluation,
        executed: false,
        message: 'Receipt policyId mismatch.',
        requestId,
      }
    }
    const verified = verifyAllowReceipt(receipt, { policy, intent: input.intent })
    if (!verified.ok) {
      return {
        mode: resolveExecuteMode(),
        evaluation,
        executed: false,
        message: `Invalid allow-receipt: ${verified.error}`,
        requestId,
      }
    }
    const consumed = store.tryConsumeReceipt(receipt.jti, {
      policyId: input.policyId,
      intentHash: receipt.intentHash,
    })
    if (!consumed) {
      return {
        mode: resolveExecuteMode(),
        evaluation,
        executed: false,
        message: 'Allow-receipt already consumed (replay blocked).',
        requestId,
      }
    }
    await store.audit({
      type: 'receipt.consumed',
      policyId: input.policyId,
      requestId,
      payload: { jti: receipt.jti, intentHash: receipt.intentHash },
    })

    const mode = resolveExecuteMode()

    if (mode === 'dry-run') {
      await store.setLedger(input.policyId, commitIntent(ledger, input.intent))
      await store.audit({
        type: 'tx.dry_run',
        policyId: input.policyId,
        requestId,
        payload: { amountUsd: input.intent.amountUsd, to: input.intent.toAddress },
      })
      const dry: GatedTransferResult = {
        mode,
        evaluation,
        executed: true,
        receiptConsumed: true,
        message: `DRY-RUN: would transfer $${input.intent.amountUsd} USDC to ${input.intent.toAddress}. Ledger updated. Set CDP_* + ALLOWLATCH_EXECUTE_MODE=live for real Base tx.`,
        requestId,
      }
      store.saveIdempotentResult(requestId, JSON.stringify(dry))
      return dry
    }

    const enforcement = resolveEnforcementMode()
    const binding = store.getWalletBinding(input.policyId)
    if (requiresSyncedPermission() && binding?.status !== 'synced') {
      return {
        mode,
        evaluation,
        executed: false,
        receiptConsumed: true,
        message:
          'wallet_native enforcement requires a synced Spend Permission. Call sync_wallet_permissions / apply_policy with ALLOWLATCH_SMART_ACCOUNT + CDP credentials.',
        requestId,
      }
    }

    const { kit, walletAddress, networkId } = await getKitBundle()
    const tokenAddress = usdcAddressForNetwork(networkId)
    const smartAccount = process.env.ALLOWLATCH_SMART_ACCOUNT?.trim()

    // Hybrid / wallet_native: pull USDC via Spend Permission into the AgentKit wallet, then transfer.
    if (
      (enforcement === 'hybrid' || enforcement === 'wallet_native') &&
      smartAccount &&
      binding?.status === 'synced'
    ) {
      const usePerm = kit.getActions().find((a: { name: string }) => a.name === 'use_spend_permission')
      if (usePerm) {
        await usePerm.invoke({
          smartAccountAddress: smartAccount,
          value: String(input.intent.amountUsd),
          network: networkId.includes('sepolia') ? 'base-sepolia' : 'base',
        })
        await store.audit({
          type: 'wallet.spend_permission_used',
          policyId: input.policyId,
          requestId,
          payload: { smartAccount, amountUsd: input.intent.amountUsd },
        })
      } else if (enforcement === 'wallet_native') {
        return {
          mode,
          evaluation,
          executed: false,
          receiptConsumed: true,
          message: 'use_spend_permission action unavailable on this AgentKit wallet provider.',
          requestId,
        }
      }
    }

    const transfer = kit.getActions().find((a: { name: string }) => a.name === 'transfer')
    if (!transfer) {
      throw new Error('AgentKit transfer action not available')
    }

    await store.audit({
      type: 'tx.submitted',
      policyId: input.policyId,
      requestId,
      payload: {
        amountUsd: input.intent.amountUsd,
        to: input.intent.toAddress,
        walletAddress,
        enforcement,
      },
    })

    const result = await transfer.invoke({
      amount: String(input.intent.amountUsd),
      tokenAddress,
      destinationAddress: input.intent.toAddress!,
    })

    await store.setLedger(input.policyId, commitIntent(ledger, input.intent))

    const resultText = typeof result === 'string' ? result : JSON.stringify(result)
    const txHash = resultText.match(/0x[a-fA-F0-9]{64}/)?.[0]
    await store.audit({
      type: 'tx.confirmed',
      policyId: input.policyId,
      requestId,
      payload: { txHash, walletAddress, amountUsd: input.intent.amountUsd, enforcement },
    })

    const live: GatedTransferResult = {
      mode,
      evaluation,
      executed: true,
      txHash,
      walletAddress,
      receiptConsumed: true,
      message: resultText,
      requestId,
    }
    store.saveIdempotentResult(requestId, JSON.stringify(live))
    return live
  })
}
