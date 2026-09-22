/**
 * Bind claimed amountUsd to on-chain-shaped fields so a lying intent cannot outspend the policy.
 * USDC on Base / Base Sepolia uses 6 decimals.
 */
import type { MandatePolicy, SpendIntent } from './schema.js'

const TRANSFER_SELECTOR = '0xa9059cbb'
const USDC_DECIMALS = 6
const USDC_BY_CHAIN: Record<MandatePolicy['chain'], string> = {
  base: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  'base-sepolia': '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
}

export function usdcAtomicFromUsd(amountUsd: number): bigint {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0n
  return BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS))
}

export function formatUsdcAtomic(atomic: bigint): string {
  return atomic.toString()
}

function normalizeHex(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  const h = raw.trim().toLowerCase()
  return h.startsWith('0x') ? h : `0x${h}`
}

function normalizeAddr(addr?: string): string | undefined {
  if (!addr?.trim()) return undefined
  return addr.trim().toLowerCase()
}

/** Decode ERC-20 transfer(address,uint256) calldata. */
export function decodeErc20Transfer(calldata: string): {
  to: string
  amount: bigint
} | null {
  const hex = normalizeHex(calldata)
  if (!hex || !hex.startsWith(TRANSFER_SELECTOR)) return null
  // 4 byte selector + 32 to + 32 amount
  if (hex.length < 2 + 8 + 64 + 64) return null
  const toWord = hex.slice(10, 74)
  const amountWord = hex.slice(74, 138)
  const to = `0x${toWord.slice(24)}`
  try {
    const amount = BigInt(`0x${amountWord}`)
    return { to, amount }
  } catch {
    return null
  }
}

function looksLikeUsdc(policy: MandatePolicy, intent: SpendIntent): boolean {
  const symbol = intent.symbol?.toUpperCase()
  if (symbol === 'USDC') return true
  if (!symbol && policy.currency === 'USDC' && intent.action !== 'swap') return true
  const token = normalizeAddr(intent.tokenAddress)
  if (token && token === USDC_BY_CHAIN[policy.chain]) return true
  return false
}

/**
 * Returns deny reasons when claimed USD and on-chain shaped amount disagree,
 * or when a USDC transfer/x402 lacks a binding field.
 */
export function checkAmountBinding(
  policy: MandatePolicy,
  intent: SpendIntent
): string[] {
  if (intent.action === 'swap') return []

  const reasons: string[] = []
  const expected = usdcAtomicFromUsd(intent.amountUsd)
  const tokenAmountRaw = intent.tokenAmount?.trim()
  const calldata = normalizeHex(intent.calldata)

  let boundAtomic: bigint | null = null
  let boundTo: string | undefined

  if (tokenAmountRaw) {
    if (!/^\d+$/.test(tokenAmountRaw)) {
      reasons.push('tokenAmount must be a non-negative integer string (atomic units).')
      return reasons
    }
    boundAtomic = BigInt(tokenAmountRaw)
  }

  if (calldata) {
    const decoded = decodeErc20Transfer(calldata)
    if (!decoded) {
      reasons.push(
        'calldata must be an ERC-20 transfer(address,uint256) (selector 0xa9059cbb) when provided.'
      )
      return reasons
    }
    if (boundAtomic != null && decoded.amount !== boundAtomic) {
      reasons.push(
        `calldata amount ${decoded.amount} does not match tokenAmount ${boundAtomic}.`
      )
    }
    boundAtomic = boundAtomic ?? decoded.amount
    boundTo = decoded.to
    const sel = intent.functionSelector?.toLowerCase()
    if (sel && sel !== TRANSFER_SELECTOR) {
      reasons.push(
        `functionSelector ${intent.functionSelector} does not match transfer calldata.`
      )
    }
  }

  if (looksLikeUsdc(policy, intent)) {
    if (boundAtomic == null) {
      reasons.push(
        'USDC transfer/x402_pay requires tokenAmount (6-decimal atomic string) or ERC-20 transfer calldata — amountUsd alone is not binding.'
      )
      return reasons
    }
    if (boundAtomic !== expected) {
      reasons.push(
        `Bound token amount ${boundAtomic} (atomic) does not match amountUsd $${intent.amountUsd} (expected ${expected}).`
      )
    }
  } else if (boundAtomic != null) {
    // Non-USDC: still refuse internal contradiction if both claim fields disagree with amountUsd scaling unknown —
    // only enforce when caller also set amountUsd consistency via explicit tokenAmount matching expected if they claim USDC decimals.
    // For non-USDC we only check calldata↔tokenAmount and toAddress.
  }

  if (boundTo && intent.toAddress) {
    const claimed = normalizeAddr(intent.toAddress)
    if (claimed && claimed !== boundTo) {
      reasons.push(
        `calldata recipient ${boundTo} does not match toAddress ${intent.toAddress}.`
      )
    }
  }

  return reasons
}
