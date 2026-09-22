/**
 * Property-based invariants for the deterministic gate.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'

process.env.ALLOWLATCH_TENANT_AUTH = '0'
process.env.ALLOWLATCH_RECEIPT_SECRET = 'test-secret-allowlatch-pbt'

import { DEMO_POLICY, type MandatePolicy, type SpendIntent } from './schema.js'
import { commitIntent, evaluateIntent, freshLedger, rollLedger } from './engine.js'

const arbAmount = fc.double({ min: 0.01, max: 500, noNaN: true })
const arbAction = fc.constantFrom('transfer', 'swap', 'x402_pay') as fc.Arbitrary<
  SpendIntent['action']
>

const arbIntent: fc.Arbitrary<SpendIntent> = fc
  .record({
    action: arbAction,
    amountUsd: arbAmount,
    symbol: fc.option(fc.constantFrom('ETH', 'USDC', 'PEPE', 'WETH'), { nil: undefined }),
    toAddress: fc.option(
      fc.constantFrom(
        '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
        '0x1111111111111111111111111111111111111111'
      ),
      { nil: undefined }
    ),
    calldataHash: fc.option(fc.constant('0x' + 'ab'.repeat(16)), { nil: undefined }),
    chainId: fc.option(fc.constantFrom(8453, 84532, 1), { nil: undefined }),
  })
  .map((r) => {
    const intent: SpendIntent = {
      action: r.action,
      amountUsd: r.amountUsd,
    }
    if (r.symbol) intent.symbol = r.symbol
    if (r.toAddress) intent.toAddress = r.toAddress
    if (r.action === 'swap') {
      intent.calldataHash = r.calldataHash ?? '0x' + 'cd'.repeat(16)
      intent.contractAddress = r.toAddress
    } else {
      // USDC-shaped spends must bind atomic amount (policy currency is USDC).
      const needsBind = !r.symbol || r.symbol === 'USDC'
      if (needsBind) {
        intent.tokenAmount = String(Math.round(r.amountUsd * 1e6))
        if (!r.symbol) intent.symbol = 'USDC'
      }
      if (r.calldataHash) intent.calldataHash = r.calldataHash
    }
    if (r.chainId != null) intent.chainId = r.chainId
    return intent
  })

describe('evaluateIntent properties', () => {
  it('never returns empty reasons on deny/escalate', () => {
    fc.assert(
      fc.property(arbIntent, (intent) => {
        const r = evaluateIntent(DEMO_POLICY, intent, freshLedger())
        if (r.decision === 'deny' || r.decision === 'escalate') {
          assert.ok(r.reasons.length > 0)
        }
        assert.ok(['allow', 'deny', 'escalate'].includes(r.decision))
      }),
      { numRuns: 80 }
    )
  })

  it('allow never exceeds maxPerOrderUsd', () => {
    fc.assert(
      fc.property(arbIntent, (intent) => {
        const r = evaluateIntent(DEMO_POLICY, intent, freshLedger())
        if (r.decision === 'allow') {
          assert.ok(intent.amountUsd <= DEMO_POLICY.capital.maxPerOrderUsd)
        }
      }),
      { numRuns: 80 }
    )
  })

  it('swap without calldataHash always denies', () => {
    fc.assert(
      fc.property(arbAmount, (amountUsd) => {
        const r = evaluateIntent(
          DEMO_POLICY,
          { action: 'swap', amountUsd, symbol: 'ETH' },
          freshLedger()
        )
        assert.equal(r.decision, 'deny')
        assert.match(r.reasons.join(' '), /calldataHash/i)
      }),
      { numRuns: 40 }
    )
  })

  it('commitIntent is monotonic on lifetime', () => {
    fc.assert(
      fc.property(arbAmount, (amountUsd) => {
        const before = freshLedger()
        const intent: SpendIntent = {
          action: 'transfer',
          amountUsd,
          toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
        }
        const after = commitIntent(before, intent)
        assert.ok(after.spentUsdLifetime >= before.spentUsdLifetime)
        assert.ok(after.spentUsdToday >= 0)
      }),
      { numRuns: 40 }
    )
  })

  it('rollLedger never increases lifetime', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.integer({ min: 0, max: 86_400_000 }),
        (lifetime, offsetMs) => {
          const ledger = {
            ...freshLedger(new Date(0)),
            spentUsdLifetime: lifetime,
            spentUsdToday: 10,
          }
          const rolled = rollLedger(ledger, new Date(offsetMs))
          assert.equal(rolled.spentUsdLifetime, lifetime)
        }
      ),
      { numRuns: 40 }
    )
  })

  it('emergencyStop always denies', () => {
    const stopped: MandatePolicy = {
      ...DEMO_POLICY,
      risk: { ...DEMO_POLICY.risk, emergencyStop: true },
    }
    fc.assert(
      fc.property(arbIntent, (intent) => {
        const r = evaluateIntent(stopped, intent, freshLedger())
        assert.equal(r.decision, 'deny')
      }),
      { numRuns: 40 }
    )
  })
})
