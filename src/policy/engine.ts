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
    spentUsdLifetime: 0,
    gasUsdToday: 0,
  }
}

/** Roll ledger windows forward if the calendar day/hour changed. Lifetime is never reset. */
export function rollLedger(ledger: SpendLedger, now = new Date()): SpendLedger {
  const dayKey = utcDayKey(now)
  const hourKey = utcHourKey(now)
  const sameDay = ledger.dayKey === dayKey
  return {
    dayKey,
    spentUsdToday: sameDay ? ledger.spentUsdToday : 0,
    hourKey,
    txCountThisHour: ledger.hourKey === hourKey ? ledger.txCountThisHour : 0,
    spentUsdLifetime: ledger.spentUsdLifetime ?? 0,
    gasUsdToday: sameDay ? (ledger.gasUsdToday ?? 0) : 0,
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
  const remainingLifetimeUsd = Math.max(
    0,
    policy.capital.agentWalletBudgetUsd - state.spentUsdLifetime
  )

  if (policy.risk?.emergencyStop) {
    return {
      decision: 'deny',
      reasons: ['Emergency stop is active on this policy. All spends are blocked.'],
      policyName: policy.name,
      remainingDailyUsd,
      remainingLifetimeUsd,
      intent,
    }
  }

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

  if (intent.amountUsd > remainingLifetimeUsd) {
    reasons.push(
      `Amount $${intent.amountUsd} would exceed lifetime wallet budget (remaining $${remainingLifetimeUsd.toFixed(2)} of $${policy.capital.agentWalletBudgetUsd}).`
    )
  }

  if (state.txCountThisHour >= policy.capital.maxTransactionsPerHour) {
    reasons.push(
      `Hourly velocity cap reached (${policy.capital.maxTransactionsPerHour} tx/hour). Possible runaway loop.`
    )
  }

  const maxGas = policy.capital.maxGasUsdPerDay
  if (
    maxGas != null &&
    intent.estimatedGasUsd != null &&
    state.gasUsdToday + intent.estimatedGasUsd > maxGas
  ) {
    reasons.push(
      `Estimated gas $${intent.estimatedGasUsd} would exceed daily gas cap (remaining $${Math.max(0, maxGas - state.gasUsdToday).toFixed(2)} of $${maxGas}).`
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

  const contract = normalizeAddress(intent.contractAddress)
  const deniedContracts = (policy.universe.deniedContracts ?? []).map(normalizeAddress)
  const allowedContracts = (policy.universe.allowedContracts ?? []).map(normalizeAddress)
  if (contract && deniedContracts.includes(contract)) {
    reasons.push(`Contract ${intent.contractAddress} is denied.`)
  }
  if (contract && allowedContracts.length > 0 && !allowedContracts.includes(contract)) {
    reasons.push(`Contract ${intent.contractAddress} is not on the contract allowlist.`)
  }
  if (!contract && allowedContracts.length > 0 && intent.action === 'swap') {
    reasons.push('contractAddress required when a contract allowlist is active for swaps.')
  }

  const sel = intent.functionSelector?.toLowerCase()
  const deniedSelectors = (policy.universe.deniedFunctionSelectors ?? []).map((s) =>
    s.toLowerCase()
  )
  const allowedSelectors = (policy.universe.allowedFunctionSelectors ?? []).map((s) =>
    s.toLowerCase()
  )
  if (sel && deniedSelectors.includes(sel)) {
    reasons.push(`Function selector ${intent.functionSelector} is denied.`)
  }
  if (sel && allowedSelectors.length > 0 && !allowedSelectors.includes(sel)) {
    reasons.push(`Function selector ${intent.functionSelector} is not on the selector allowlist.`)
  }
  if (!sel && allowedSelectors.length > 0) {
    reasons.push('functionSelector required when a selector allowlist is active.')
  }

  const maxSlip = policy.risk?.maxSlippageBps
  if (
    intent.action === 'swap' &&
    maxSlip != null &&
    intent.slippageBps != null &&
    intent.slippageBps > maxSlip
  ) {
    reasons.push(
      `Slippage ${intent.slippageBps} bps exceeds policy max ${maxSlip} bps.`
    )
  }

  if (reasons.length > 0) {
    return {
      decision: 'deny',
      reasons,
      policyName: policy.name,
      remainingDailyUsd,
      remainingLifetimeUsd,
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
      remainingLifetimeUsd,
      intent,
    }
  }

  return {
    decision: 'allow',
    reasons: ['All policy checks passed.'],
    policyName: policy.name,
    remainingDailyUsd: remainingDailyUsd - intent.amountUsd,
    remainingLifetimeUsd: remainingLifetimeUsd - intent.amountUsd,
    intent,
  }
}

/** Apply an allowed intent to the ledger (call only after ALLOW and successful tx / dry-run commit). */
export function commitIntent(ledger: SpendLedger, intent: SpendIntent, now = new Date()): SpendLedger {
  const state = rollLedger(ledger, now)
  return {
    ...state,
    spentUsdToday: state.spentUsdToday + intent.amountUsd,
    spentUsdLifetime: state.spentUsdLifetime + intent.amountUsd,
    txCountThisHour: state.txCountThisHour + 1,
    gasUsdToday: state.gasUsdToday + (intent.estimatedGasUsd ?? 0),
  }
}
