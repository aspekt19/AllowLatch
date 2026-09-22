import {
  type EvaluationResult,
  type MandatePolicy,
  type SpendIntent,
  type SpendLedger,
} from './schema.js'
import { checkAmountBinding } from './amount-bind.js'

/** Canonical USDC contracts for Base chains (currency=USDC policies). */
export const USDC_BY_CHAIN = {
  base: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  'base-sepolia': '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
} as const

export const CHAIN_IDS = {
  base: 8453,
  'base-sepolia': 84532,
} as const

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

/** Roll ledger windows forward if the calendar day/hour changed (UTC). Lifetime is never reset. */
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

function resolveIntentChain(
  policy: MandatePolicy,
  intent: SpendIntent
): { ok: true } | { ok: false; reason: string } {
  const expectedId = CHAIN_IDS[policy.chain]
  if (intent.chainId != null && intent.chainId !== expectedId) {
    return {
      ok: false,
      reason: `chainId ${intent.chainId} does not match policy chain ${policy.chain} (${expectedId}).`,
    }
  }
  if (intent.networkId?.trim()) {
    const n = intent.networkId.trim().toLowerCase()
    const aliases =
      policy.chain === 'base'
        ? ['base', 'base-mainnet']
        : ['base-sepolia', 'base_sepolia', 'basesepolia']
    if (!aliases.includes(n) && n !== policy.chain) {
      return {
        ok: false,
        reason: `networkId "${intent.networkId}" does not match policy chain ${policy.chain}.`,
      }
    }
  }
  return { ok: true }
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

  const chainCheck = resolveIntentChain(policy, intent)
  if (!chainCheck.ok) reasons.push(chainCheck.reason)

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

  const token = normalizeAddress(intent.tokenAddress)
  const deniedTokens = (policy.universe.deniedTokenAddresses ?? []).map(normalizeAddress)
  const allowedTokens = (policy.universe.allowedTokenAddresses ?? []).map(normalizeAddress)
  if (token && deniedTokens.includes(token)) {
    reasons.push(`Token contract ${intent.tokenAddress} is denied.`)
  }
  if (token && allowedTokens.length > 0 && !allowedTokens.includes(token)) {
    reasons.push(`Token contract ${intent.tokenAddress} is not on the token allowlist.`)
  }
  if (!token && allowedTokens.length > 0) {
    reasons.push('tokenAddress required when a token-contract allowlist is active.')
  }
  // Symbol USDC must bind to the canonical Base USDC contract when tokenAddress is set.
  if (token && symbol === 'USDC') {
    const expectedUsdc = USDC_BY_CHAIN[policy.chain]
    if (token !== expectedUsdc) {
      reasons.push(
        `tokenAddress ${intent.tokenAddress} is not the canonical USDC for ${policy.chain} (${expectedUsdc}).`
      )
    }
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

  // Bind claimed USD to tokenAmount / ERC-20 transfer calldata (USDC transfers).
  reasons.push(...checkAmountBinding(policy, intent))

  // Bind swap ALLOW to exact calldata so a receipt cannot authorize a mutated router call.
  if (intent.action === 'swap' && !intent.calldataHash?.trim()) {
    reasons.push(
      'calldataHash required for swap intents (binds the allow-receipt to exact calldata bytes).'
    )
  }
  if (intent.action === 'swap' && !intent.contractAddress?.trim() && !intent.toAddress?.trim()) {
    reasons.push('Swap intents require contractAddress or toAddress (router).')
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
