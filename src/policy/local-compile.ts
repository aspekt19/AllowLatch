/**
 * Offline Policy Copilot draft for the UI demo (no LLM).
 * Mirrors SERV draft shape: policy + conflicts / assumptions / questions.
 */
import { DEMO_POLICY, MandatePolicySchema, type MandatePolicy, type PolicyDraft } from './schema.js'

const UNISWAP_BASE = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'

function pickAmount(text: string, patterns: RegExp[], fallback: number): number {
  for (const re of patterns) {
    // Never reuse /g lastIndex across calls — clone without sticky state.
    const local = new RegExp(re.source, re.flags.replace(/g/g, ''))
    const m = text.match(local)
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

function hasDailyCap(text: string): boolean {
  return /(?:per\s*day|daily|в\s*день|за\s*день|\/\s*day)/i.test(text)
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

  // Prefer "max $X per transfer" / "макс $X за перевод" / "$X за перевод" over generic DEMO defaults.
  const perOrderPatterns = [
    /(?:макс(?:имум)?|max)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:за\s*(?:перевод|транзакц\w*|раз|операц\w*)|per\s*(?:order|tx|transfer|transaction))?/gi,
    /\$?\s*(\d+(?:\.\d+)?)\s*(?:за\s*(?:перевод|транзакц\w*|раз|операц\w*)|per\s*(?:order|tx|transfer|transaction))/gi,
    // Amount must follow immediately — do not scan across the next sentence (escalation $X).
    /(?:per\s*(?:order|tx|transaction|transfer)|за\s*(?:раз|транзакц\w*|операц\w*|перевод))\s*\$?\s*(\d+(?:\.\d+)?)/gi,
    /(?:не\s+больше|не\s+более)\s*\$?\s*(\d+(?:\.\d+)?)/gi,
  ]
  const perOrderCandidates = pickAllAmounts(lower, perOrderPatterns)
  const uniquePerOrder = [...new Set(perOrderCandidates)]
  let maxPerOrderUsd = pickAmount(lower, perOrderPatterns, DEMO_POLICY.capital.maxPerOrderUsd)

  if (uniquePerOrder.length >= 2) {
    maxPerOrderUsd = Math.min(...uniquePerOrder)
    conflicts.push(
      `Per-order amount looks ambiguous (${uniquePerOrder.map((n) => `$${n}`).join(' vs ')}); draft uses the tighter $${maxPerOrderUsd}.`
    )
    questions.push(`What should the max per transfer be: ${uniquePerOrder.map((n) => `$${n}`).join(' or ')}?`)
  } else if (uniquePerOrder.length === 0) {
    assumptions.push(`No clear per-order cap — defaulted to $${maxPerOrderUsd}.`)
  }

  const budget = pickAmount(
    lower,
    [
      /(?:budget|wallet|кошел\w*|бюджет)[^\d]{0,24}\$?\s*(\d+(?:\.\d+)?)/i,
      /\$?\s*(\d+(?:\.\d+)?)\s*usdc\s*(?:на\s+base|on\s+base)?/i,
    ],
    DEMO_POLICY.capital.agentWalletBudgetUsd
  )

  const maxNotionalUsdPerDay = hasDailyCap(lower)
    ? pickAmount(
        lower,
        [
          /(?:per\s*day|daily|в\s*день|за\s*день)[^\d]{0,20}\$?\s*(\d+(?:\.\d+)?)/i,
          /\$?\s*(\d+(?:\.\d+)?)\s*(?:per\s*day|daily|в\s*день|\/day)/i,
        ],
        Math.max(budget, maxPerOrderUsd)
      )
    : // No daily phrase → use stated wallet budget when present (sub-dollar mandates).
      (budget !== DEMO_POLICY.capital.agentWalletBudgetUsd
        ? budget
        : Math.max(DEMO_POLICY.capital.maxNotionalUsdPerDay, maxPerOrderUsd * 3))

  if (!hasDailyCap(lower) && budget !== DEMO_POLICY.capital.agentWalletBudgetUsd) {
    assumptions.push(`No daily cap stated — used wallet budget $${budget} as maxNotionalUsdPerDay.`)
  }

  const confirmAbove = pickAmount(
    lower,
    [
      /(?:эскалац\w*|escalat\w*)[^\d]{0,28}(?:выше|above|свыше)?\s*\$?\s*(\d+(?:\.\d+)?)/i,
      /(?:confirm|approval|ask\s+me|спроси|подтвержд\w*)[^\d]{0,24}\$?\s*(\d+(?:\.\d+)?)/i,
      /(?:above|свыше|выше)\s*\$?\s*(\d+(?:\.\d+)?)/i,
    ],
    // Never floor at $1 — breaks sub-dollar mandates (e.g. max $0.10).
    Math.min(maxPerOrderUsd, Math.max(maxPerOrderUsd * 0.7, Number.EPSILON))
  )
  if (/(?:ask\s+me|confirm|спроси|эскалац)/i.test(lower)) {
    assumptions.push(`Human-confirm threshold set to $${Math.min(confirmAbove, maxPerOrderUsd)}.`)
  }

  const allowedSymbols = ['USDC']
  if (/\beth\b|ethereum|эфир/i.test(lower)) {
    allowedSymbols.push('ETH', 'WETH')
  }
  const KNOWN = new Set(['WBTC', 'CBBTC', 'DAI', 'USDT', 'EURC', 'DEGEN', 'AERO'])
  for (const sym of text.toUpperCase().match(/\b[A-Z]{2,6}\b/g) ?? []) {
    if (KNOWN.has(sym) && !allowedSymbols.includes(sym)) allowedSymbols.push(sym)
  }
  assumptions.push(`Allowed symbols: ${allowedSymbols.join(', ')}.`)

  const deniedSymbols: string[] = []
  if (/no\s+meme|без\s+мем|мемкоин/i.test(lower)) {
    deniedSymbols.push('PEPE', 'DOGE', 'SHIB')
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
  if (onlyUniswap || (/uniswap|router/i.test(lower) && !/без\s+свап|no\s+swap|сторонн/i.test(lower))) {
    allowedAddresses.push(UNISWAP_BASE)
    assumptions.push('Uniswap mentioned → Base Universal Router allowlisted.')
  }
  for (const addr of text.match(/0x[a-fA-F0-9]{40}/g) ?? []) {
    if (!allowedAddresses.map((a) => a.toLowerCase()).includes(addr.toLowerCase())) {
      allowedAddresses.push(addr)
    }
  }

  const onlyTransfer =
    /только\s+перевод|only\s+transfers?\b|без\s+свап|no\s+swap|сторонн\w*\s+контракт|no\s+(?:other\s+)?contracts?/i.test(
      lower
    )
  const allowSwap = !onlyTransfer && !/no\s+swap|без\s+свап/i.test(lower)
  const allowTransfer = !/no\s+transfer|без\s+перевод(?!\s+на)/i.test(lower)
  const allowX402Pay =
    !onlyTransfer && !/no\s+x402|без\s+x402/i.test(lower)
  if (onlyTransfer) {
    assumptions.push('Transfer-only / no side contracts → swap and x402 disabled.')
  }

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
      allowedTokenAddresses: [],
      deniedTokenAddresses: [],
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
