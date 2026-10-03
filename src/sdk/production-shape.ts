/**
 * Recommended production shape for AllowLatch.
 * hybrid = receipt + required on-chain daily ceiling (fail-closed); not soft fallthrough.
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
   * Small live AgentKit balances OK only when gated path + on-chain ceiling are configured
   * (SA + CDP). Middleware / hybrid-without-SA is not ready.
   */
  readyForCoffeeMoney: boolean
  /**
   * Ordinary small personal balances: hybrid/native + SA + CDP + Turso + receipt secret.
   * Still not a third-party audit / custody-grade vault.
   */
  readyForOrdinaryBalances: boolean
  /** @deprecated Use productionPrerequisitesSatisfied / readyForOrdinaryBalances. */
  readyForSeriousFunds: boolean
  /** Infra checklist for ordinary small AgentKit balances (still not a third-party audit). */
  productionPrerequisitesSatisfied: boolean
  /** hybrid/wallet_native + Smart Account + CDP credentials present. */
  readyForHybridCeiling: boolean
  /** wallet_native mode + SA + CDP (same fail-closed ceiling naming). */
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

/** Fee economics: $0.025/check is steep vs micro transfers — prefer packKey. */
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
  const middlewareEscape = env.ALLOWLATCH_ALLOW_MIDDLEWARE_SPEND === '1'

  const readyForHybridCeiling = hybridOrNative && smartAccount && hasCdp
  const readyForWalletNative = walletNative && smartAccount && hasCdp
  const productionPrerequisitesSatisfied =
    readyForHybridCeiling && turso && receiptSecret
  const readyForCoffeeMoney = readyForHybridCeiling
  const readyForOrdinaryBalances = productionPrerequisitesSatisfied
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
      ok: hybridOrNative && !middlewareEscape,
      severity: 'required',
      message: middlewareEscape
        ? 'ALLOWLATCH_ALLOW_MIDDLEWARE_SPEND=1 — demo/lab only; not for ordinary balances.'
        : hybridOrNative
          ? `Enforcement=${enforcement} (receipt + required on-chain daily ceiling; fail-closed without synced Spend Permission).`
          : 'ALLOWLATCH_ENFORCEMENT=middleware — demo only. Use hybrid or wallet_native for ordinary balances.',
    },
    {
      id: 'spend-permission',
      ok: smartAccount && hasCdp,
      severity: 'required',
      message:
        smartAccount && hasCdp
          ? 'Smart account + CDP set — sync Spend Permission (hybrid_plan / hybrid_report). Re-sync after capital changes.'
          : 'Set ALLOWLATCH_SMART_ACCOUNT + CDP_* and sync Spend Permission. Without this, hybrid/wallet_native refuse spend.',
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
        : 'For micro transfers, buy_pack + packKey (~$0.008/check) beats $0.025 per evaluate.',
    },
    {
      id: 'ordinary-balances',
      ok: readyForOrdinaryBalances,
      severity: 'required',
      message: readyForOrdinaryBalances
        ? 'Ordinary small balances: SA + synced Spend Permission + durable Turso + receipt secret. Still no third-party audit.'
        : 'Ordinary balances need hybrid/native + SA + CDP + Turso + receipt secret. Demo/middleware without SA stays lab-only.',
    },
  ]

  return {
    readyForCoffeeMoney,
    readyForOrdinaryBalances,
    readyForSeriousFunds,
    productionPrerequisitesSatisfied,
    readyForHybridCeiling,
    readyForWalletNative,
    checks,
    summary: productionPrerequisitesSatisfied
      ? 'Ordinary small AgentKit balances OK with fail-closed hybrid ceiling (not audited custody). Keep treasury key off the agent.'
      : readyForHybridCeiling
        ? 'Hybrid ceiling credentials present — finish Turso + receipt secret before ordinary balances.'
        : hybridOrNative
          ? 'Enforcement fail-closed but Smart Account/CDP missing — spends will refuse until Spend Permission sync.'
          : 'Use createGatedAgentKit + hybrid Spend Permissions; middleware alone is demo-only.',
  }
}

/** One-line operator hint (stderr-friendly). */
export function formatProductionShapeHint(report: ProductionShapeReport = recommendProductionShape()): string {
  const gaps = report.checks.filter((c) => !c.ok && c.severity !== 'info')
  if (gaps.length === 0) return `AllowLatch: ${report.summary}`
  return `AllowLatch: ${report.summary} Gaps: ${gaps.map((g) => g.id).join(', ')}.`
}
