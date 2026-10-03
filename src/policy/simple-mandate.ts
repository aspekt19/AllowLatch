/**
 * Turn simple owner fields into a natural-language mandate for SERV draft.
 * Does NOT produce MandatePolicy — Copilot / engine still own the structured policy.
 */

export type SimpleRulesInput = {
  dailyUsd: number
  maxPerTransferUsd: number
  /** Lifetime budget; defaults to max(daily * 5, daily) if omitted. */
  budgetUsd?: number
  addresses: string[]
  escalateAboveUsd?: number
  allowSwaps?: boolean
}

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/

export function parseAddressLines(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split(/[\s,;]+/)) {
    const a = line.trim()
    if (!a) continue
    if (!EVM_ADDR.test(a)) continue
    const key = a.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

export function validateSimpleRules(input: SimpleRulesInput): string | null {
  if (!Number.isFinite(input.dailyUsd) || input.dailyUsd <= 0) {
    return 'Daily max must be a positive number.'
  }
  if (!Number.isFinite(input.maxPerTransferUsd) || input.maxPerTransferUsd <= 0) {
    return 'Max per transfer must be a positive number.'
  }
  if (input.maxPerTransferUsd > input.dailyUsd) {
    return 'Max per transfer cannot exceed the daily max.'
  }
  if (input.addresses.length === 0) {
    return 'Add at least one allowlisted address (0x…).'
  }
  if (input.escalateAboveUsd != null) {
    if (!Number.isFinite(input.escalateAboveUsd) || input.escalateAboveUsd < 0) {
      return 'Escalate threshold must be a non-negative number.'
    }
    if (input.escalateAboveUsd > input.maxPerTransferUsd) {
      return 'Escalate threshold cannot exceed max per transfer.'
    }
  }
  return null
}

/**
 * Human mandate text fed into `/api/copilot` draft (same SERV path as free-text).
 */
export function simpleRulesToMandateText(input: SimpleRulesInput): string {
  const err = validateSimpleRules(input)
  if (err) throw new Error(err)

  const daily = roundMoney(input.dailyUsd)
  const perTx = roundMoney(input.maxPerTransferUsd)
  const budget = roundMoney(input.budgetUsd ?? Math.max(daily * 5, daily))
  const escalate =
    input.escalateAboveUsd != null
      ? roundMoney(input.escalateAboveUsd)
      : roundMoney(Math.min(perTx, Math.max(perTx * 0.5, 0.01)))

  const addrList = input.addresses.map((a) => a.trim()).join(', ')
  const swaps = input.allowSwaps === true ? 'Swaps allowed only if needed.' : 'No swaps.'

  return [
    `Budget $${budget} USDC on Base.`,
    `Max $${perTx} per transfer and $${daily} per day.`,
    `Only allow transfers to ${addrList}.`,
    swaps,
    `Escalate above $${escalate}.`,
    'Only USDC. Ask me before anything unusual.',
  ].join(' ')
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}
