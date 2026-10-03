import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { DEMO_POLICY } from '../policy/schema.js'
import {
  dailyAllowanceAtomic,
  invalidateWalletBindingIfStale,
  planSpendPermission,
  requiresSyncedPermission,
  spendPermissionMatchesPolicy,
} from './spend-permissions.js'

const SA = '0x1111111111111111111111111111111111111111'
const SPENDER = '0x2222222222222222222222222222222222222222'

describe('spend-permissions', () => {
  const prevEnforcement = process.env.ALLOWLATCH_ENFORCEMENT
  const prevSa = process.env.ALLOWLATCH_SMART_ACCOUNT

  before(() => {
    process.env.ALLOWLATCH_ENFORCEMENT = 'hybrid'
    process.env.ALLOWLATCH_SMART_ACCOUNT = SA
    process.env.CDP_WALLET_ADDRESS = SPENDER
    process.env.ALLOWLATCH_EXECUTE_MODE = 'dry-run'
  })

  after(() => {
    if (prevEnforcement === undefined) delete process.env.ALLOWLATCH_ENFORCEMENT
    else process.env.ALLOWLATCH_ENFORCEMENT = prevEnforcement
    if (prevSa === undefined) delete process.env.ALLOWLATCH_SMART_ACCOUNT
    else process.env.ALLOWLATCH_SMART_ACCOUNT = prevSa
  })

  it('plans daily allowance from maxNotionalUsdPerDay', () => {
    const policy = {
      ...DEMO_POLICY,
      capital: { ...DEMO_POLICY.capital, maxNotionalUsdPerDay: 10, maxPerOrderUsd: 1 },
    }
    const plan = planSpendPermission({ policy, smartAccount: SA, spender: SPENDER })
    assert.equal(plan.status, 'planned')
    assert.equal(plan.allowanceAtomic, dailyAllowanceAtomic(policy))
    assert.equal(plan.allowanceAtomic, '10000000') // $10 * 1e6
    assert.equal(plan.maxPerOrderUsd, 1)
    assert.match(plan.message, /soft-cap/)
  })

  it('detects stale synced binding after daily cap drop', () => {
    const high = {
      ...DEMO_POLICY,
      capital: { ...DEMO_POLICY.capital, maxNotionalUsdPerDay: 10 },
    }
    const low = {
      ...DEMO_POLICY,
      capital: { ...DEMO_POLICY.capital, maxNotionalUsdPerDay: 2 },
    }
    const synced = {
      status: 'synced',
      allowanceAtomic: dailyAllowanceAtomic(high),
      smartAccount: SA,
      spender: SPENDER,
    }
    assert.equal(spendPermissionMatchesPolicy(synced, high), true)
    assert.equal(spendPermissionMatchesPolicy(synced, low), false)

    const invalidated = invalidateWalletBindingIfStale(synced, low)
    assert.ok(invalidated)
    assert.equal(invalidated.status, 'planned')
    assert.equal(invalidated.stale, true)
    assert.equal(String(invalidated.allowanceAtomic), dailyAllowanceAtomic(low))
    assert.equal(spendPermissionMatchesPolicy(invalidated, low), false)
  })

  it('hybrid and wallet_native require a synced permission; middleware does not', () => {
    delete process.env.ALLOWLATCH_ALLOW_MIDDLEWARE_SPEND
    process.env.ALLOWLATCH_ENFORCEMENT = 'hybrid'
    assert.equal(requiresSyncedPermission(), true)
    process.env.ALLOWLATCH_ENFORCEMENT = 'wallet_native'
    assert.equal(requiresSyncedPermission(), true)
    process.env.ALLOWLATCH_ENFORCEMENT = 'middleware'
    assert.equal(requiresSyncedPermission(), false)
    process.env.ALLOWLATCH_ENFORCEMENT = 'hybrid'
    process.env.ALLOWLATCH_ALLOW_MIDDLEWARE_SPEND = '1'
    assert.equal(requiresSyncedPermission(), false)
    delete process.env.ALLOWLATCH_ALLOW_MIDDLEWARE_SPEND
    process.env.ALLOWLATCH_ENFORCEMENT = 'hybrid'
  })

  it('keeps matching synced binding after apply with same daily cap', () => {
    const policy = {
      ...DEMO_POLICY,
      capital: { ...DEMO_POLICY.capital, maxNotionalUsdPerDay: 5 },
    }
    const synced = {
      status: 'synced',
      allowanceAtomic: dailyAllowanceAtomic(policy),
      smartAccount: SA,
      spender: SPENDER,
    }
    const next = invalidateWalletBindingIfStale(synced, policy)
    assert.equal(next, synced)
  })
})
