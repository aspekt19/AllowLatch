import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { DEMO_POLICY } from '../policy/schema.js'
import {
  HYBRID_KEY_INVARIANT,
  siteGateApply,
  siteGateHybridPlan,
  siteGateHybridReport,
  siteGateHybridStatus,
  siteGateSyncWallet,
  siteGateGetWalletBinding,
} from './site-gate.js'

before(() => {
  process.env.ALLOWLATCH_RECEIPT_SECRET = 'test-site-gate-hybrid-secret'
  process.env.ALLOWLATCH_EXECUTE_MODE = 'dry-run'
  delete process.env.ALLOWLATCH_TURSO_DATABASE_URL
  delete process.env.TURSO_DATABASE_URL
  delete process.env.ALLOWLATCH_SMART_ACCOUNT
  delete process.env.CDP_WALLET_ADDRESS
})

const SA = '0x1111111111111111111111111111111111111111'
const SPENDER = '0x2222222222222222222222222222222222222222'

describe('site-gate hybrid ceiling', () => {
  it('hybrid_plan returns createSpendPermission steps + key invariant', async () => {
    const applied = await siteGateApply({
      policyId: 'hybrid-plan-a',
      ownerId: 'owner-hybrid',
      policy: DEMO_POLICY,
    })
    const planned = await siteGateHybridPlan({
      policyId: applied.policyId,
      sessionSeal: applied.sessionSeal,
      smartAccount: SA,
      spender: SPENDER,
    })
    assert.equal(planned.ok, true)
    assert.equal(planned.plan.smartAccount, SA)
    assert.equal(planned.plan.spender, SPENDER)
    assert.equal(planned.createSpendPermission.token, 'usdc')
    assert.equal(planned.createSpendPermission.periodInDays, 1)
    assert.ok(planned.steps.length >= 4)
    assert.match(planned.invariant, /private key/i)
    assert.equal(planned.invariant, HYBRID_KEY_INVARIANT)
  })

  it('sync_wallet dry-run persists binding for ownerToken', async () => {
    const applied = await siteGateApply({
      policyId: 'hybrid-sync-a',
      ownerId: 'owner-sync',
      policy: DEMO_POLICY,
    })
    const synced = await siteGateSyncWallet({
      policyId: applied.policyId,
      ownerToken: applied.ownerToken,
      sessionSeal: applied.sessionSeal,
      smartAccount: SA,
      spender: SPENDER,
      dryRun: true,
    })
    assert.equal(synced.walletNative.status, 'planned')
    assert.equal(synced.binding.path, 'human_sa')
    const stored = await siteGateGetWalletBinding(applied.policyId)
    assert.equal(stored?.spender, SPENDER)
    assert.equal(stored?.smartAccount, SA)
  })

  it('sync_wallet rejects wrong ownerToken', async () => {
    const applied = await siteGateApply({
      policyId: 'hybrid-sync-b',
      ownerId: 'owner-sync-b',
      policy: DEMO_POLICY,
    })
    await assert.rejects(
      () =>
        siteGateSyncWallet({
          policyId: applied.policyId,
          ownerToken: 'definitely-wrong-token',
          sessionSeal: applied.sessionSeal,
          smartAccount: SA,
          spender: SPENDER,
          dryRun: true,
        }),
      /ownerToken mismatch/
    )
  })

  it('hybrid_report stores agent_cdp binding', async () => {
    const applied = await siteGateApply({
      policyId: 'hybrid-report-a',
      ownerId: 'owner-report',
      policy: DEMO_POLICY,
    })
    const reported = await siteGateHybridReport({
      policyId: applied.policyId,
      sessionSeal: applied.sessionSeal,
      smartAccount: SA,
      spender: SPENDER,
      status: 'synced',
      userOpHash: '0xabc',
    })
    assert.equal(reported.binding.path, 'agent_cdp')
    assert.equal(reported.binding.status, 'synced')
    assert.equal(reported.binding.userOpHash, '0xabc')
  })

  it('hybrid_status is unmatched until a synced binding matches the daily cap', async () => {
    const applied = await siteGateApply({
      policyId: 'hybrid-status-a',
      ownerId: 'owner-status',
      policy: DEMO_POLICY,
    })
    const before = await siteGateHybridStatus({
      policyId: applied.policyId,
      sessionSeal: applied.sessionSeal,
    })
    assert.equal(before.matchesPolicy, false)
    assert.equal(before.required, true)

    const reported = await siteGateHybridReport({
      policyId: applied.policyId,
      sessionSeal: applied.sessionSeal,
      smartAccount: SA,
      spender: SPENDER,
      status: 'synced',
    })
    assert.equal(reported.binding.status, 'synced')
    const after = await siteGateHybridStatus({
      policyId: applied.policyId,
      sessionSeal: before.binding ? applied.sessionSeal : applied.sessionSeal,
    })
    assert.equal(after.matchesPolicy, true)
  })

  it('hybrid_status rejects a stale synced allowance', async () => {
    const high = {
      ...DEMO_POLICY,
      capital: { ...DEMO_POLICY.capital, maxNotionalUsdPerDay: 10 },
    }
    const applied = await siteGateApply({
      policyId: 'hybrid-status-stale',
      ownerId: 'owner-status-stale',
      policy: high,
    })
    await siteGateHybridReport({
      policyId: applied.policyId,
      sessionSeal: applied.sessionSeal,
      smartAccount: SA,
      spender: SPENDER,
      status: 'synced',
    })
    const low = {
      ...DEMO_POLICY,
      capital: { ...DEMO_POLICY.capital, maxNotionalUsdPerDay: 2 },
    }
    const again = await siteGateApply({
      policyId: applied.policyId,
      ownerId: 'owner-status-stale',
      ownerToken: applied.ownerToken,
      policy: low,
      sessionSeal: applied.sessionSeal,
    })
    const status = await siteGateHybridStatus({
      policyId: again.policyId,
      sessionSeal: again.sessionSeal,
    })
    assert.equal(status.matchesPolicy, false)
  })

  it('apply with lower daily cap invalidates synced Spend Permission binding', async () => {
    const high = {
      ...DEMO_POLICY,
      capital: { ...DEMO_POLICY.capital, maxNotionalUsdPerDay: 10 },
    }
    const applied = await siteGateApply({
      policyId: 'hybrid-stale-a',
      ownerId: 'owner-stale',
      policy: high,
    })
    await siteGateHybridReport({
      policyId: applied.policyId,
      sessionSeal: applied.sessionSeal,
      smartAccount: SA,
      spender: SPENDER,
      status: 'synced',
    })
    const before = await siteGateGetWalletBinding(applied.policyId)
    assert.equal(before?.status, 'synced')

    const low = {
      ...DEMO_POLICY,
      capital: { ...DEMO_POLICY.capital, maxNotionalUsdPerDay: 2 },
    }
    const again = await siteGateApply({
      policyId: applied.policyId,
      ownerId: 'owner-stale',
      ownerToken: applied.ownerToken,
      policy: low,
      sessionSeal: applied.sessionSeal,
    })
    const after = await siteGateGetWalletBinding(again.policyId)
    assert.equal(after?.status, 'planned')
    assert.equal(after?.stale, true)
    assert.match(String(after?.message ?? ''), /re-sync|changed/i)
  })
})
