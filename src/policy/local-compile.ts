import { DEMO_POLICY, type MandatePolicy } from './schema.js'

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

/**
 * Offline heuristic compiler for the UI demo (no LLM).
 * Good enough for hackathon dialog; OpenServ compile_mandate is the production path.
 */
export function compileMandateLocally(mandateText: string): MandatePolicy {
  const text = mandateText.trim()
  const lower = text.toLowerCase()

  const maxPerOrderUsd = pickAmount(
    lower,
    [
      /(?:per\s*(?:order|tx|transaction|transfer)|за\s*(?:раз|транзакц\w*|операц\w*))[^\d]{0,20}\$?\s*(\d+(?:\.\d+)?)/i,
      /(?:max|максимум|не больше|не более)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:per|за)?/i,
      /\$\s*(\d+(?:\.\d+)?)\s*(?:per\s*(?:order|tx)|за\s*раз)/i,
    ],
    DEMO_POLICY.capital.maxPerOrderUsd
  )

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
      /(?:confirm|approval|спроси|подтвержд\w*)[^\d]{0,24}\$?\s*(\d+(?:\.\d+)?)/i,
      /(?:above|свыше|выше)\s*\$?\s*(\d+(?:\.\d+)?)/i,
    ],
    Math.min(maxPerOrderUsd, Math.max(1, maxPerOrderUsd * 0.7))
  )

  const budget = pickAmount(
    lower,
    [/(?:budget|wallet|кошел\w*|бюджет)[^\d]{0,20}\$?\s*(\d+(?:\.\d+)?)/i],
    DEMO_POLICY.capital.agentWalletBudgetUsd
  )

  const allowedSymbols = ['USDC']
  if (/\beth\b|ethereum|эфир/i.test(lower)) {
    allowedSymbols.push('ETH', 'WETH')
  }
  // Only known ticker-like tokens — do not scoop English words from the mandate text
  const KNOWN = new Set(['WBTC', 'CBBTC', 'DAI', 'USDT', 'EURC', 'DEGEN', 'AERO'])
  for (const sym of text.toUpperCase().match(/\b[A-Z]{2,6}\b/g) ?? []) {
    if (KNOWN.has(sym) && !allowedSymbols.includes(sym)) allowedSymbols.push(sym)
  }

  const deniedSymbols = ['PEPE']
  if (/no\s+meme|без\s+мем/i.test(lower)) deniedSymbols.push('DOGE', 'SHIB')

  const allowedAddresses: string[] = []
  if (/uniswap|router/i.test(lower)) allowedAddresses.push(UNISWAP_BASE)
  for (const addr of text.match(/0x[a-fA-F0-9]{40}/g) ?? []) {
    if (!allowedAddresses.map((a) => a.toLowerCase()).includes(addr.toLowerCase())) {
      allowedAddresses.push(addr)
    }
  }

  const allowSwap = !/no\s+swap|без\s+свап/i.test(lower)
  const allowTransfer = !/no\s+transfer|без\s+перевод/i.test(lower)
  const allowX402Pay = !/no\s+x402|без\s+x402/i.test(lower)

  const name =
    text.length > 40 ? `${text.slice(0, 37).trim()}…` : text || DEMO_POLICY.name

  return {
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
    },
    actions: { allowSwap, allowTransfer, allowX402Pay },
    escalation: {
      requireHumanConfirmAboveUsd: Math.min(confirmAbove, maxPerOrderUsd),
    },
  }
}
