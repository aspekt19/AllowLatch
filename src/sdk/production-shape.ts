/**
 * Recommended production shape for AllowLatch — distilled from security reviews.
 * Middleware alone is not a lock; hybrid Spend Permissions are the on-chain ceiling.
 */
import { SITE_GATE_PRICE_USD } from '../http/x402-site-gate-config.js'

export type ProductionCheck = {
  id: string
  ok: boolean
  severity: 'required' | 'recommended' | 'info'
  message: string
}

export type ProductionShapeReport = {
  readyForCoffeeMoney: boolean
  readyForSeriousFunds: boolean
  checks: ProductionCheck[]
  summary: string
}

export type FeeAdvice = {
  gatePriceUsd: number
  amountUsd: number
  feeRatio: number
  preferPack: boolean
  message: string
}

/** Fee economics: $0.025/check is steep vs coffee-money transfers — prefer packKey. */
export function feeAdviceForSpend(amountUsd: number, opts?: { hasPackKey?: boolean }): FeeAdvice {
  const amount = Number.isFinite(amountUsd) ? Math.max(0, amountUsd) : 0
  const feeRatio = amount > 0 ? SITE_GATE_PRICE_USD / amount : Number.POSITIVE_INFINITY
  const preferPack = !opts?.hasPackKey && (amount <= 0 || feeRatio >= 0.15)
  const message = preferPack
    ? `Gate fee $${SITE_GATE_PRICE_USD} is ${
        amount > 0 ? `${Math.round(feeRatio * 100)}% of this $${amount} spend` : 'charged per evaluate'
      }. Prefer buy_pack + packKey (~$0.008/check) for micro transfers.`
    : opts?.hasPackKey
      ? 'Using prepaid packKey credits — good for micro evaluates.'
      : `Per-call x402 ($${SITE_GATE_PRICE_USD}) is acceptable vs this spend size.`
  return {
    gatePriceUsd: SITE_GATE_PRICE_USD,
    amountUsd: amount,
    feeRatio: Number.isFinite(feeRatio) ? feeRatio : Number.POSITIVE_INFINITY,
    preferPack,
    message,
  }
}

/**
 * Checklist for “how I would actually run AllowLatch with money”.
 * Env-based — safe to call from createGatedAgentKit / CLIs.
 */
export function recommendProductionShape(env: NodeJS.ProcessEnv = process.env): ProductionShapeReport {
  const smartAccount = Boolean(env.ALLOWLATCH_SMART_ACCOUNT?.trim())
  const enforcement = (env.ALLOWLATCH_ENFORCEMENT ?? 'hybrid').trim().toLowerCase()
  const hybridOrNative = enforcement === 'hybrid' || enforcement === 'wallet_native'
  const receiptSecret = Boolean(env.ALLOWLATCH_RECEIPT_SECRET?.trim())
  const turso = Boolean(env.ALLOWLATCH_TURSO_DATABASE_URL?.trim())
  const packKey = Boolean(env.ALLOWLATCH_PACK_KEY?.trim())
  const hasCdp =
    Boolean(env.CDP_API_KEY_ID?.trim()) && Boolean(env.CDP_API_KEY_SECRET?.trim())

  const checks: ProductionCheck[] = [
    {
      id: 'gated-kit',
      ok: true,
      severity: 'required',
      message:
        'Spend only via createGatedAgentKit({ kind: "site" }). assertSpend alone is advisory if a raw signer remains.',
    },
    {
      id: 'no-raw-parallel',
      ok: true,
      severity: 'required',
      message:
        'Do not give the agent a parallel ungated wallet.sendTransaction. Prefer a session key / smart-account spender.',
    },
    {
      id: 'hybrid',
      ok: hybridOrNative,
      severity: 'required',
      message: hybridOrNative
        ? `Enforcement=${enforcement} (receipt + on-chain ceiling intent).`
        : 'ALLOWLATCH_ENFORCEMENT=middleware — not custody-grade. Use hybrid or wallet_native.',
    },
    {
      id: 'spend-permission',
      ok: smartAccount && hasCdp,
      severity: 'required',
      message:
        smartAccount && hasCdp
          ? 'Smart account + CDP set — sync Spend Permission so daily USDC cap holds on-chain.'
          : 'Set ALLOWLATCH_SMART_ACCOUNT + CDP_* and sync Spend Permission (hybrid). Without this, middleware can be bypassed.',
    },
    {
      id: 'receipt-secret',
      ok: receiptSecret,
      severity: 'recommended',
      message: receiptSecret
        ? 'ALLOWLATCH_RECEIPT_SECRET is set (do not reuse SERV_API_KEY).'
        : 'Set dedicated ALLOWLATCH_RECEIPT_SECRET for receipts + sessionSeal.',
    },
    {
      id: 'durable-ledger',
      ok: turso,
      severity: 'recommended',
      message: turso
        ? 'Turso durable ledger enabled for /api/gate.'
        : 'No Turso — demo seals only. Prefer ALLOWLATCH_TURSO_* for shared ledger + pack credits.',
    },
    {
      id: 'pack-credits',
      ok: packKey || turso,
      severity: 'info',
      message: packKey
        ? 'ALLOWLATCH_PACK_KEY set — micro evaluates avoid full $0.025 each time.'
        : 'For coffee-money transfers, buy_pack + packKey (~$0.008/check) beats $0.025 per evaluate.',
    },
    {
      id: 'coffee-money',
      ok: true,
      severity: 'required',
      message:
        'Keep hot balances coffee-money until independent audit. Hosted gate = SaaS authorization (operator trust), not a vault.',
    },
  ]

  // Serious funds need the on-chain ceiling actually configured, not just hybrid intent.
  const readyForSeriousFunds = hybridOrNative && smartAccount && hasCdp && turso && receiptSecret

  return {
    readyForCoffeeMoney: hybridOrNative,
    readyForSeriousFunds,
    checks,
    summary: readyForSeriousFunds
      ? 'Production shape looks solid for small live balances (still not audited custody).'
      : smartAccount && hasCdp
        ? 'Gated path + hybrid intent present — finish Turso + receipt secret; keep balances small.'
        : 'Use createGatedAgentKit + hybrid Spend Permissions; without on-chain caps this is a journal/advisor, not a lock.',
  }
}

/** One-line operator hint (stderr-friendly). */
export function formatProductionShapeHint(report: ProductionShapeReport = recommendProductionShape()): string {
  const gaps = report.checks.filter((c) => !c.ok && c.severity !== 'info')
  if (gaps.length === 0) return `AllowLatch: ${report.summary}`
  return `AllowLatch: ${report.summary} Gaps: ${gaps.map((g) => g.id).join(', ')}.`
}
