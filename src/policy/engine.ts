import {
  type EvaluationResult,
  type MandatePolicy,
  type SpendIntent,
  type SpendLedger,
} from './schema.js'

function normalizeAddress(addr?: string): string | undefined {
  if (!addr) return undefined
  return addr.trim().toLowerCase()
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function utcHourKey(d = new Date()): string {
  const iso = d.toISOString()
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}`
}

export function freshLedger(now = new Date()): SpendLedger {
  return {
    dayKey: utcDayKey(now),
    spentUsdToday: 0,
    hourKey: utcHourKey(now),
    txCountThisHour: 0,
  }
}

/** Roll ledger windows forward if the calendar day/hour changed. */
export function rollLedger(ledger: SpendLedger, now = new Date()): SpendLedger {
  const dayKey = utcDayKey(now)
  const hourKey = utcHourKey(now)
  return {
    dayKey,
    spentUsdToday: ledger.dayKey === dayKey ? ledger.spentUsdToday : 0,
    hourKey,
    txCountThisHour: ledger.hourKey === hourKey ? ledger.txCountThisHour : 0,
  }
}

/**
 * Deterministic policy gate. LLM must NOT override this — it only proposes intents.
 */
export function evaluateIntent(
  policy: MandatePolicy,
  intent: SpendIntent,
  ledger: SpendLedger,
  now = new Date()
): EvaluationResult {
  const state = rollLedger(ledger, now)
  const reasons: string[] = []
  const remainingDailyUsd = Math.max(
    0,
    policy.capital.maxNotionalUsdPerDay - state.spentUsdToday
  )

  const actionOk =
    (intent.action === 'swap' && policy.actions.allowSwap) ||
    (intent.action === 'transfer' && policy.actions.allowTransfer) ||
    (intent.action === 'x402_pay' && policy.actions.allowX402Pay)

  if (!actionOk) {
    reasons.push(`Action "${intent.action}" is disabled by policy "${policy.name}".`)
  }

  if (intent.amountUsd > policy.capital.maxPerOrderUsd) {
    reasons.push(
      `Amount $${intent.amountUsd} exceeds max per order $${policy.capital.maxPerOrderUsd}.`
    )
  }

  if (intent.amountUsd > remainingDailyUsd) {
    reasons.push(
      `Amount $${intent.amountUsd} would exceed daily cap (remaining $${remainingDailyUsd.toFixed(2)} of $${policy.capital.maxNotionalUsdPerDay}).`
    )
  }

  if (state.txCountThisHour >= policy.capital.maxTransactionsPerHour) {
    reasons.push(
      `Hourly velocity cap reached (${policy.capital.maxTransactionsPerHour} tx/hour). Possible runaway loop.`
    )
  }

  const symbol = intent.symbol?.toUpperCase()
  if (symbol && policy.universe.deniedSymbols.map((s) => s.toUpperCase()).includes(symbol)) {
    reasons.push(`Symbol ${symbol} is on the deny list.`)
  }
  if (
    symbol &&
    policy.universe.allowedSymbols.length > 0 &&
    !policy.universe.allowedSymbols.map((s) => s.toUpperCase()).includes(symbol)
  ) {
    reasons.push(
      `Symbol ${symbol} is not in the allowlist (${policy.universe.allowedSymbols.join(', ')}).`
    )
  }

  const to = normalizeAddress(intent.toAddress)
  const denied = policy.universe.deniedAddresses.map(normalizeAddress)
  const allowed = policy.universe.allowedAddresses.map(normalizeAddress)

  if (to && denied.includes(to)) {
    reasons.push(`Destination ${intent.toAddress} is denied.`)
  }
  if (to && allowed.length > 0 && !allowed.includes(to)) {
    reasons.push(`Destination ${intent.toAddress} is not on the address allowlist.`)
  }
  // Transfers / x402 without a destination cannot be allowlist-checked strictly;
  // require an address when allowlist is non-empty.
  if (!to && allowed.length > 0 && intent.action !== 'swap') {
    reasons.push('Destination address required when an address allowlist is active.')
  }

  if (reasons.length > 0) {
    return {
      decision: 'deny',
      reasons,
      policyName: policy.name,
      remainingDailyUsd,
      intent,
    }
  }

  if (intent.amountUsd > policy.escalation.requireHumanConfirmAboveUsd) {
    return {
      decision: 'escalate',
      reasons: [
        `Amount $${intent.amountUsd} is above human-confirm threshold $${policy.escalation.requireHumanConfirmAboveUsd}. Policy would otherwise allow this.`,
      ],
      policyName: policy.name,
      remainingDailyUsd,
      intent,
    }
  }

  return {
    decision: 'allow',
    reasons: ['All policy checks passed.'],
    policyName: policy.name,
    remainingDailyUsd: remainingDailyUsd - intent.amountUsd,
    intent,
  }
}

/** Apply an allowed intent to the ledger (call only after ALLOW and successful tx). */
export function commitIntent(ledger: SpendLedger, intent: SpendIntent, now = new Date()): SpendLedger {
  const state = rollLedger(ledger, now)
  return {
    ...state,
    spentUsdToday: state.spentUsdToday + intent.amountUsd,
    txCountThisHour: state.txCountThisHour + 1,
  }
}
