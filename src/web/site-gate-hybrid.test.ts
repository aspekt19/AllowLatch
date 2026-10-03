import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { DEMO_POLICY } from '../policy/schema.js'
import {
  HYBRID_KEY_INVARIANT,
  siteGateApply,
  siteGateHybridPlan,
  siteGateHybridReport,
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
})
