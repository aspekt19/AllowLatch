/**
 * Recommended production shape for AllowLatch — distilled from security reviews.
 * hybrid = defense-in-depth (receipt + optional on-chain ceiling); not hard enforcement alone.
 */
import { SITE_GATE_PRICE_USD } from '../http/x402-site-gate-config.js'

export type ProductionCheck = {
  id: string
  ok: boolean
  severity: 'required' | 'recommended' | 'info'
  message: string
}

export type ProductionShapeReport = {
  /**
   * Small live balances OK only when gated path + on-chain ceiling are actually configured
   * (SA + CDP). Middleware / hybrid-intent-without-SA is not coffee-ready.
   */
  readyForCoffeeMoney: boolean
  /** @deprecated Use productionPrerequisitesSatisfied — name implied unaudited custody. */
  readyForSeriousFunds: boolean
  /** Infra checklist for small live AgentKit balances (still not a third-party audit). */
  productionPrerequisitesSatisfied: boolean
  /** hybrid/wallet_native + Smart Account + CDP credentials present. */
  readyForHybridCeiling: boolean
  /** wallet_native mode + SA + CDP (execution refuses without synced permission). */
  readyForWalletNative: boolean
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
  const walletNative = enforcement === 'wallet_native'
  const receiptSecret = Boolean(env.ALLOWLATCH_RECEIPT_SECRET?.trim())
  const turso = Boolean(env.ALLOWLATCH_TURSO_DATABASE_URL?.trim())
  const packKey = Boolean(env.ALLOWLATCH_PACK_KEY?.trim())
  const hasCdp =
    Boolean(env.CDP_API_KEY_ID?.trim()) && Boolean(env.CDP_API_KEY_SECRET?.trim())

  const readyForHybridCeiling = hybridOrNative && smartAccount && hasCdp
  const readyForWalletNative = walletNative && smartAccount && hasCdp
  const productionPrerequisitesSatisfied =
    readyForHybridCeiling && turso && receiptSecret
  // Coffee-money needs the on-chain ceiling configured — hybrid intent alone is a journal.
  const readyForCoffeeMoney = readyForHybridCeiling
  const readyForSeriousFunds = productionPrerequisitesSatisfied

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
        'Do not put the funded private key in the agent. Prefer Smart Account treasury + AgentKit spender.',
    },
    {
      id: 'hybrid',
      ok: hybridOrNative,
      severity: 'required',
      message: hybridOrNative
        ? `Enforcement=${enforcement} (receipt + on-chain ceiling intent; hybrid is defense-in-depth).`
        : 'ALLOWLATCH_ENFORCEMENT=middleware — not custody-grade. Use hybrid or wallet_native.',
    },
    {
      id: 'spend-permission',
      ok: smartAccount && hasCdp,
      severity: 'required',
      message:
        smartAccount && hasCdp
          ? 'Smart account + CDP set — sync Spend Permission so daily USDC cap holds on-chain (re-sync after policy capital changes).'
          : 'Set ALLOWLATCH_SMART_ACCOUNT + CDP_* and sync Spend Permission. Without this, hybrid is receipt-only defense-in-depth.',
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

  return {
    readyForCoffeeMoney,
    readyForSeriousFunds,
    productionPrerequisitesSatisfied,
    readyForHybridCeiling,
    readyForWalletNative,
    checks,
    summary: productionPrerequisitesSatisfied
      ? 'Production prerequisites satisfied for small live AgentKit balances (hybrid = defense-in-depth; not audited custody).'
      : readyForHybridCeiling
        ? 'Hybrid ceiling configured — finish Turso + receipt secret; keep balances small.'
        : hybridOrNative
          ? 'Enforcement intent set but Smart Account/CDP missing — this is a journal/advisor until Spend Permission sync.'
          : 'Use createGatedAgentKit + hybrid Spend Permissions; middleware alone is not a lock.',
  }
}

/** One-line operator hint (stderr-friendly). */
export function formatProductionShapeHint(report: ProductionShapeReport = recommendProductionShape()): string {
  const gaps = report.checks.filter((c) => !c.ok && c.severity !== 'info')
  if (gaps.length === 0) return `AllowLatch: ${report.summary}`
  return `AllowLatch: ${report.summary} Gaps: ${gaps.map((g) => g.id).join(', ')}.`
}
