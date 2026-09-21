/**
 * Offline mandate compile — sub-dollar RU/EN mandates must preserve exact caps.
 *   npm test
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { draftPolicyLocally, compileMandateLocally } from './local-compile.js'
import { MandatePolicyLlmSchema, finalizeMandatePolicy } from './schema.js'
import { zodResponseFormat } from 'openai/helpers/zod'

const LIVE_RU = `Бюджет агента $0.16 USDC на Base. Макс $0.10 за перевод. Эскалация выше $0.05. Разрешён только перевод на 0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205 адрес. Без свапов и сторонних контрактов.`

describe('draftPolicyLocally', () => {
  it('preserves sub-dollar RU mandate caps and allowlist', () => {
    const { policy, readyToApply } = draftPolicyLocally(LIVE_RU)
    assert.equal(policy.capital.agentWalletBudgetUsd, 0.16)
    assert.equal(policy.capital.maxPerOrderUsd, 0.1)
    assert.equal(policy.capital.maxNotionalUsdPerDay, 0.16)
    assert.equal(policy.escalation.requireHumanConfirmAboveUsd, 0.05)
    assert.equal(policy.actions.allowSwap, false)
    assert.equal(policy.actions.allowTransfer, true)
    assert.equal(policy.actions.allowX402Pay, false)
    assert.equal(policy.universe.allowedAddresses.length, 1)
    assert.equal(
      policy.universe.allowedAddresses[0]!.toLowerCase(),
      '0x5cc0aa9ed773f413f81f78a62f2e94109ce26205'
    )
    assert.equal(readyToApply, true)
  })

  it('compileMandateLocally matches draft policy', () => {
    const p = compileMandateLocally(LIVE_RU)
    assert.equal(p.capital.maxPerOrderUsd, 0.1)
  })

  it('does not floor confirm threshold at $1 for tiny maxPerOrder', () => {
    const p = draftPolicyLocally(
      'Budget $5. Max $0.20 per transfer. Ask me above $0.12. Only transfer to 0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205.'
    ).policy
    assert.equal(p.capital.maxPerOrderUsd, 0.2)
    assert.equal(p.escalation.requireHumanConfirmAboveUsd, 0.12)
  })
})

describe('MandatePolicyLlmSchema', () => {
  it('is accepted by zodResponseFormat (no ZodDefault)', () => {
    assert.doesNotThrow(() => zodResponseFormat(MandatePolicyLlmSchema, 'mandate_policy'))
  })

  it('finalizeMandatePolicy applies runtime defaults', () => {
    const policy = finalizeMandatePolicy({
      version: '1.0',
      name: 't',
      chain: 'base',
      currency: 'USDC',
      capital: {
        agentWalletBudgetUsd: 0.16,
        maxNotionalUsdPerDay: 0.16,
        maxPerOrderUsd: 0.1,
        maxTransactionsPerHour: 10,
      },
      universe: {
        allowedSymbols: ['USDC'],
        deniedSymbols: [],
        allowedAddresses: ['0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205'],
        deniedAddresses: [],
        allowedContracts: [],
        deniedContracts: [],
        allowedTokenAddresses: [],
        deniedTokenAddresses: [],
        allowedFunctionSelectors: [],
        deniedFunctionSelectors: [],
      },
      actions: { allowSwap: false, allowTransfer: true, allowX402Pay: false },
      risk: { emergencyStop: false },
      escalation: { requireHumanConfirmAboveUsd: 0.05 },
    })
    assert.equal(policy.risk.emergencyStop, false)
    assert.equal(policy.capital.maxPerOrderUsd, 0.1)
  })
})
