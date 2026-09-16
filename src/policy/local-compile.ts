/**
 * Offline Policy Copilot draft for the UI demo (no LLM).
 * Mirrors SERV draft shape: policy + conflicts / assumptions / questions.
 */
import { DEMO_POLICY, MandatePolicySchema, type MandatePolicy, type PolicyDraft } from './schema.js'

const UNISWAP_BASE = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'

function pickAmount(text: string, patterns: RegExp[], fallback: number): number {
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      const n = Number(m[1].replace(',', ''))
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return fallback
}

function pickAllAmounts(text: string, patterns: RegExp[]): number[] {
  const out: number[] = []
  for (const re of patterns) {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
    const global = new RegExp(re.source, flags)
    for (const m of text.matchAll(global)) {
      const n = Number(m[1]?.replace(',', ''))
      if (Number.isFinite(n) && n > 0) out.push(n)
    }
  }
  return out
}

/** @deprecated Prefer draftPolicyLocally — kept for callers that want policy only. */
export function compileMandateLocally(mandateText: string): MandatePolicy {
  return draftPolicyLocally(mandateText).policy
}

/**
 * Offline heuristic Policy Copilot draft (UI / no SERV key).
 */
export function draftPolicyLocally(mandateText: string): PolicyDraft {
  const text = mandateText.trim()
  const lower = text.toLowerCase()
  const conflicts: string[] = []
  const assumptions: string[] = []
  const questions: string[] = []

  const perOrderCandidates = pickAllAmounts(lower, [
    /(?:per\s*(?:order|tx|transaction|transfer)|за\s*(?:раз|транзакц\w*|операц\w*))[^\d]{0,20}\$?\s*(\d+(?:\.\d+)?)/gi,
    /(?:max|максимум|не больше|не более)\s*\$?\s*(\d+(?:\.\d+)?)/gi,
    /maybe\s*\$?\s*(\d+(?:\.\d+)?)/gi,
    /or\s+(?:wait\s+)?maybe\s*\$?\s*(\d+(?:\.\d+)?)/gi,
  ])
  const uniquePerOrder = [...new Set(perOrderCandidates)]
  let maxPerOrderUsd = pickAmount(
    lower,
    [
      /(?:per\s*(?:order|tx|transaction|transfer)|за\s*(?:раз|транзакц\w*|операц\w*))[^\d]{0,20}\$?\s*(\d+(?:\.\d+)?)/i,
      /(?:max|максимум|не больше|не более)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:per|за)?/i,
      /\$\s*(\d+(?:\.\d+)?)\s*(?:per\s*(?:order|tx)|за\s*раз)/i,
    ],
    DEMO_POLICY.capital.maxPerOrderUsd
  )

  if (uniquePerOrder.length >= 2) {
    maxPerOrderUsd = Math.min(...uniquePerOrder)
    conflicts.push(
      `Per-order amount looks ambiguous (${uniquePerOrder.map((n) => `$${n}`).join(' vs ')}); draft uses the tighter $${maxPerOrderUsd}.`
    )
    questions.push(`What should the max per transfer be: ${uniquePerOrder.map((n) => `$${n}`).join(' or ')}?`)
  } else if (!/\$?\s*\d/.test(lower) || !/(?:per|max|transfer|tx)/i.test(lower)) {
    assumptions.push(`No clear per-order cap — defaulted to $${maxPerOrderUsd}.`)
  }

  if (/weekend|weekends|выходн/i.test(lower)) {
    conflicts.push(
      'Weekend / day-of-week exceptions are not expressible in v1 policy — a single daily cap is used every day.'
    )
    questions.push('How should weekend spending be handled without day-of-week rules?')
  }

  const maxNotionalUsdPerDay = pickAmount(
    lower,
    [
      /(?:per\s*day|daily|в\s*день|за\s*день)[^\d]{0,20}\$?\s*(\d+(?:\.\d+)?)/i,
      /\$?\s*(\d+(?:\.\d+)?)\s*(?:per\s*day|daily|в\s*день|\/day)/i,
    ],
    Math.max(DEMO_POLICY.capital.maxNotionalUsdPerDay, maxPerOrderUsd * 3)
  )

  const confirmAbove = pickAmount(
    lower,
    [
      /(?:confirm|approval|ask\s+me|спроси|подтвержд\w*)[^\d]{0,24}\$?\s*(\d+(?:\.\d+)?)/i,
      /(?:above|свыше|выше)\s*\$?\s*(\d+(?:\.\d+)?)/i,
    ],
    Math.min(maxPerOrderUsd, Math.max(1, maxPerOrderUsd * 0.7))
  )
  if (/(?:ask\s+me|confirm|спроси)/i.test(lower)) {
    assumptions.push(`Human-confirm threshold set to $${Math.min(confirmAbove, maxPerOrderUsd)}.`)
  }

  const budget = pickAmount(
    lower,
    [/(?:budget|wallet|кошел\w*|бюджет)[^\d]{0,20}\$?\s*(\d+(?:\.\d+)?)/i],
    DEMO_POLICY.capital.agentWalletBudgetUsd
  )

  const allowedSymbols = ['USDC']
  if (/\beth\b|ethereum|эфир/i.test(lower)) {
    allowedSymbols.push('ETH', 'WETH')
  }
  const KNOWN = new Set(['WBTC', 'CBBTC', 'DAI', 'USDT', 'EURC', 'DEGEN', 'AERO'])
  for (const sym of text.toUpperCase().match(/\b[A-Z]{2,6}\b/g) ?? []) {
    if (KNOWN.has(sym) && !allowedSymbols.includes(sym)) allowedSymbols.push(sym)
  }
  assumptions.push(`Allowed symbols: ${allowedSymbols.join(', ')}.`)

  const deniedSymbols = ['PEPE']
  if (/no\s+meme|без\s+мем/i.test(lower)) {
    deniedSymbols.push('DOGE', 'SHIB')
    assumptions.push('Meme ban → PEPE / DOGE / SHIB on deny list.')
  }

  const allowedAddresses: string[] = []
  const anyAddress =
    /any\s+address|любой\s+адрес/i.test(lower) && !/only\s+uniswap|только\s+uniswap/i.test(lower)
  const onlyUniswap = /only\s+uniswap|только\s+uniswap|uniswap\s+ok|uniswap\s+allowed|router\s+allowed/i.test(
    lower
  )

  if (anyAddress && onlyUniswap) {
    conflicts.push('Mandate both opens addresses and restricts to Uniswap — draft keep Uniswap-only allowlist.')
    questions.push('Should destinations be Uniswap-only, or open to any address?')
  }
  if (onlyUniswap || /uniswap|router/i.test(lower)) {
    allowedAddresses.push(UNISWAP_BASE)
    assumptions.push('Uniswap mentioned → Base Universal Router allowlisted.')
  }
  for (const addr of text.match(/0x[a-fA-F0-9]{40}/g) ?? []) {
    if (!allowedAddresses.map((a) => a.toLowerCase()).includes(addr.toLowerCase())) {
      allowedAddresses.push(addr)
    }
  }

  const allowSwap = !/no\s+swap|без\s+свап/i.test(lower)
  const allowTransfer = !/no\s+transfer|без\s+перевод/i.test(lower)
  const allowX402Pay = !/no\s+x402|без\s+x402/i.test(lower)

  const name =
    text.length > 48 ? `${text.slice(0, 45).trim()}…` : text || DEMO_POLICY.name

  const policy: MandatePolicy = MandatePolicySchema.parse({
    version: '1.0',
    name,
    chain: 'base',
    currency: 'USDC',
    capital: {
      agentWalletBudgetUsd: budget,
      maxNotionalUsdPerDay,
      maxPerOrderUsd,
      maxTransactionsPerHour: 20,
    },
    universe: {
      allowedSymbols,
      deniedSymbols,
      allowedAddresses,
      deniedAddresses: [],
      allowedContracts: [],
      deniedContracts: [],
      allowedFunctionSelectors: [],
      deniedFunctionSelectors: [],
    },
    actions: { allowSwap, allowTransfer, allowX402Pay },
    risk: { emergencyStop: false },
    escalation: {
      requireHumanConfirmAboveUsd: Math.min(confirmAbove, maxPerOrderUsd),
    },
  })

  const readyToApply = questions.length === 0
  const summary = readyToApply
    ? `Draft ready: $${maxPerOrderUsd}/tx, $${maxNotionalUsdPerDay}/day, confirm above $${policy.escalation.requireHumanConfirmAboveUsd}.`
    : `Draft needs your review — ${questions.length} clarifying question(s) before applying.`

  return {
    policy,
    conflicts,
    assumptions,
    questions,
    readyToApply,
    summary,
  }
}
