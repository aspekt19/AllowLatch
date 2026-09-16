/**
 * Mirror MandatePolicy caps into Coinbase Spend Permissions (wallet-native).
 * Middleware gate still decides ALLOW; on-chain permission limits what the spender can pull.
 */
import { parseUnits } from 'viem'
import type { MandatePolicy } from '../policy/schema.js'

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const

export type EnforcementMode = 'middleware' | 'hybrid' | 'wallet_native'

export type WalletNativePlan = {
  mode: EnforcementMode
  networkId: string
  smartAccount?: string
  spender?: string
  token: `0x${string}`
  /** Atomic USDC units for the rolling period (daily notional). */
  allowanceAtomic: string
  periodSeconds: number
  maxPerOrderUsd: number
  status: 'planned' | 'synced' | 'skipped' | 'error'
  userOpHash?: string
  message: string
}

export function resolveEnforcementMode(): EnforcementMode {
  const raw = (process.env.ALLOWLATCH_ENFORCEMENT || '').trim().toLowerCase()
  if (raw === 'middleware' || raw === 'hybrid' || raw === 'wallet_native') return raw
  // Default: hybrid when a smart account is configured, else middleware-only.
  return process.env.ALLOWLATCH_SMART_ACCOUNT?.trim() ? 'hybrid' : 'middleware'
}

function networkId(): string {
  return process.env.NETWORK_ID || 'base-sepolia'
}

function usdcForNetwork(id: string): `0x${string}` {
  return id.includes('sepolia') ? USDC_BASE_SEPOLIA : USDC_BASE
}

/** Build the on-chain spend plan from a MandatePolicy (no RPC). */
export function planSpendPermission(args: {
  policy: MandatePolicy
  spender?: string
  smartAccount?: string
}): WalletNativePlan {
  const mode = resolveEnforcementMode()
  const net = networkId()
  const smartAccount = (args.smartAccount || process.env.ALLOWLATCH_SMART_ACCOUNT || '').trim()
  const spender = (args.spender || process.env.CDP_WALLET_ADDRESS || '').trim()
  const allowanceAtomic = parseUnits(String(args.policy.capital.maxNotionalUsdPerDay), 6).toString()

  if (mode === 'middleware') {
    return {
      mode,
      networkId: net,
      smartAccount: smartAccount || undefined,
      spender: spender || undefined,
      token: usdcForNetwork(net),
      allowanceAtomic,
      periodSeconds: 86_400,
      maxPerOrderUsd: args.policy.capital.maxPerOrderUsd,
      status: 'skipped',
      message: 'Enforcement=middleware — AllowLatch receipt gate only (no on-chain Spend Permission).',
    }
  }

  if (!smartAccount) {
    return {
      mode,
      networkId: net,
      spender: spender || undefined,
      token: usdcForNetwork(net),
      allowanceAtomic,
      periodSeconds: 86_400,
      maxPerOrderUsd: args.policy.capital.maxPerOrderUsd,
      status: mode === 'wallet_native' ? 'error' : 'skipped',
      message:
        mode === 'wallet_native'
          ? 'ALLOWLATCH_SMART_ACCOUNT required for wallet_native enforcement.'
          : 'Set ALLOWLATCH_SMART_ACCOUNT to mirror daily USDC caps on-chain (hybrid).',
    }
  }

  return {
    mode,
    networkId: net,
    smartAccount,
    spender: spender || undefined,
    token: usdcForNetwork(net),
    allowanceAtomic,
    periodSeconds: 86_400,
    maxPerOrderUsd: args.policy.capital.maxPerOrderUsd,
    status: 'planned',
    message: `Plan: grant spender daily allowance $${args.policy.capital.maxNotionalUsdPerDay} USDC (period 1d), per-tx soft-cap $${args.policy.capital.maxPerOrderUsd} via AllowLatch receipt.`,
  }
}

/**
 * Create / refresh a CDP Spend Permission matching the policy daily cap.
 * No-ops (planned/skipped) when CDP or smart account missing — unless wallet_native.
 */
export async function syncSpendPermission(args: {
  policy: MandatePolicy
  spender?: string
  dryRun?: boolean
}): Promise<WalletNativePlan> {
  const plan = planSpendPermission({
    policy: args.policy,
    spender: args.spender,
  })

  if (plan.status !== 'planned') return plan
  if (args.dryRun || resolveExecuteIsDry()) {
    return { ...plan, status: 'planned', message: `${plan.message} (dry-run — not submitted on-chain)` }
  }

  const apiKeyId = process.env.CDP_API_KEY_ID?.trim()
  const apiKeySecret = process.env.CDP_API_KEY_SECRET?.trim()
  const walletSecret = process.env.CDP_WALLET_SECRET?.trim()
  if (!apiKeyId || !apiKeySecret || !walletSecret) {
    return {
      ...plan,
      status: plan.mode === 'wallet_native' ? 'error' : 'skipped',
      message: 'CDP credentials missing — cannot submit Spend Permission.',
    }
  }
  if (!plan.smartAccount || !plan.spender) {
    return {
      ...plan,
      status: 'error',
      message: 'smartAccount and spender addresses required to sync Spend Permission.',
    }
  }

  try {
    const { CdpClient } = await import('@coinbase/cdp-sdk')
    const cdp = new CdpClient({
      apiKeyId,
      apiKeySecret,
      walletSecret,
    })
    const network = plan.networkId.includes('sepolia') ? 'base-sepolia' : 'base'
    const userOp = await cdp.evm.createSpendPermission({
      network,
      spendPermission: {
        account: plan.smartAccount as `0x${string}`,
        spender: plan.spender as `0x${string}`,
        token: 'usdc',
        allowance: BigInt(plan.allowanceAtomic),
        periodInDays: 1,
      },
    })
    return {
      ...plan,
      status: 'synced',
      userOpHash: userOp.userOpHash,
      message: `Spend Permission synced on ${network}: daily $${args.policy.capital.maxNotionalUsdPerDay} USDC to spender ${plan.spender}. userOp=${userOp.userOpHash}`,
    }
  } catch (err) {
    return {
      ...plan,
      status: 'error',
      message: `Spend Permission sync failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function resolveExecuteIsDry(): boolean {
  const forced = process.env.ALLOWLATCH_EXECUTE_MODE
  if (forced === 'dry-run') return true
  if (forced === 'live') return false
  return !(
    process.env.CDP_API_KEY_ID &&
    process.env.CDP_API_KEY_SECRET &&
    process.env.CDP_WALLET_SECRET
  )
}

/** True when live execute must have a synced on-chain permission. */
export function requiresSyncedPermission(): boolean {
  return resolveEnforcementMode() === 'wallet_native'
}
