import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  feeAdviceForSpend,
  formatProductionShapeHint,
  recommendProductionShape,
} from './production-shape.js'

describe('production-shape', () => {
  it('flags micro spends for pack credits', () => {
    const advice = feeAdviceForSpend(0.1)
    assert.equal(advice.preferPack, true)
    assert.match(advice.message, /packKey|buy_pack/)
  })

  it('skips pack hint when packKey already set', () => {
    const advice = feeAdviceForSpend(0.1, { hasPackKey: true })
    assert.equal(advice.preferPack, false)
  })

  it('hybrid intent without SA is not coffee-ready', () => {
    const thin = recommendProductionShape({ ALLOWLATCH_ENFORCEMENT: 'hybrid' })
    assert.equal(thin.readyForCoffeeMoney, false)
    assert.equal(thin.readyForOrdinaryBalances, false)
    assert.equal(thin.readyForHybridCeiling, false)
    assert.equal(thin.productionPrerequisitesSatisfied, false)
    assert.equal(thin.readyForSeriousFunds, false)
    assert.match(thin.summary, /fail-closed|refuse|missing/i)
  })

  it('requires SA + CDP + Turso + receipt for production prerequisites', () => {
    const full = recommendProductionShape({
      ALLOWLATCH_ENFORCEMENT: 'hybrid',
      ALLOWLATCH_SMART_ACCOUNT: '0xabc',
      CDP_API_KEY_ID: 'id',
      CDP_API_KEY_SECRET: 'secret',
      ALLOWLATCH_RECEIPT_SECRET: 'receipt',
      ALLOWLATCH_TURSO_DATABASE_URL: 'libsql://demo',
    })
    assert.equal(full.readyForHybridCeiling, true)
    assert.equal(full.readyForCoffeeMoney, true)
    assert.equal(full.readyForOrdinaryBalances, true)
    assert.equal(full.productionPrerequisitesSatisfied, true)
    assert.equal(full.readyForSeriousFunds, true)
    assert.match(full.summary, /ordinary small|fail-closed/i)
    assert.match(formatProductionShapeHint(full), /AllowLatch/)
  })

  it('marks middleware as demo-only', () => {
    const report = recommendProductionShape({ ALLOWLATCH_ENFORCEMENT: 'middleware' })
    const hybrid = report.checks.find((c) => c.id === 'hybrid')
    assert.ok(hybrid)
    assert.equal(hybrid.ok, false)
    assert.equal(report.readyForCoffeeMoney, false)
    assert.equal(report.readyForOrdinaryBalances, false)
  })

  it('readyForWalletNative only in wallet_native mode with SA+CDP', () => {
    const hybrid = recommendProductionShape({
      ALLOWLATCH_ENFORCEMENT: 'hybrid',
      ALLOWLATCH_SMART_ACCOUNT: '0xabc',
      CDP_API_KEY_ID: 'id',
      CDP_API_KEY_SECRET: 'secret',
    })
    assert.equal(hybrid.readyForWalletNative, false)

    const native = recommendProductionShape({
      ALLOWLATCH_ENFORCEMENT: 'wallet_native',
      ALLOWLATCH_SMART_ACCOUNT: '0xabc',
      CDP_API_KEY_ID: 'id',
      CDP_API_KEY_SECRET: 'secret',
    })
    assert.equal(native.readyForWalletNative, true)
  })
})
