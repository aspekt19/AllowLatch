import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEMO_POLICY, type MandatePolicy } from '../policy/schema.js'

const dir = await mkdtemp(join(tmpdir(), 'allowlatch-durable-'))
process.env.ALLOWLATCH_TURSO_DATABASE_URL = `file:${join(dir, 'gate.db')}`
process.env.ALLOWLATCH_RECEIPT_SECRET = 'durable-test-secret'
delete process.env.ALLOWLATCH_TURSO_AUTH_TOKEN
delete process.env.TURSO_DATABASE_URL
delete process.env.TURSO_AUTH_TOKEN

const durable = await import('./site-gate-durable.js')

const policy: MandatePolicy = {
  ...DEMO_POLICY,
  capital: {
    agentWalletBudgetUsd: 5,
    maxNotionalUsdPerDay: 5,
    maxPerOrderUsd: 4,
    maxTransactionsPerHour: 10,
  },
  escalation: { requireHumanConfirmAboveUsd: 100 },
}

const intent = {
  action: 'transfer' as const,
  amountUsd: 4,
  symbol: 'USDC',
  tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  tokenAmount: '4000000',
  toAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  chainId: 8453,
}

describe('durable site gate', () => {
  after(async () => {
    durable.resetDurableClientForTests()
    await rm(dir, { recursive: true, force: true })
  })

  it('lets only one of two parallel allows reserve the budget', async () => {
    await durable.durableApply({ policyId: 'race-1', ownerId: 'owner-a', policy })
    const [a, b] = await Promise.all([
      durable.durableEvaluate({ policyId: 'race-1', intent }),
      durable.durableEvaluate({ policyId: 'race-1', intent }),
    ])
    const decisions = [a.decision, b.decision].sort()
    assert.deepEqual(decisions, ['allow', 'deny'])
    const allowed = a.decision === 'allow' ? a : b
    assert.ok(allowed.receipt?.jti)
  })

  it('keeps the owner token as the only update credential', async () => {
    const applied = await durable.durableApply({
      policyId: 'own-1',
      ownerId: 'owner-a',
      policy,
    })
    await assert.rejects(
      () => durable.durableApply({ policyId: 'own-1', ownerId: 'owner-a', policy }),
      /ownerToken required/
    )
    await assert.rejects(
      () =>
        durable.durableApply({
          policyId: 'own-1',
          ownerId: 'owner-b',
          ownerToken: applied.ownerToken,
          policy,
        }),
      /ownerId does not match/
    )
    const updated = await durable.durableApply({
      policyId: 'own-1',
      ownerId: 'owner-a',
      ownerToken: applied.ownerToken,
      policy: { ...policy, name: 'renamed' },
    })
    assert.equal(updated.policy.name, 'renamed')
    assert.equal(updated.seq, applied.seq + 1)
  })

  it('counts rate limits in the shared store', async () => {
    assert.equal((await durable.durableRateLimit('bucket-a', 2)).ok, true)
    assert.equal((await durable.durableRateLimit('bucket-a', 2)).ok, true)
    assert.equal((await durable.durableRateLimit('bucket-a', 2)).ok, false)
    assert.equal((await durable.durableRateLimit('bucket-b', 2)).ok, true)
  })

  it('mints and burns pack credits', async () => {
    const minted = await durable.durableAddPackCredits('pack-test-1')
    assert.equal(minted.added, 3)
    assert.equal(minted.credits, 3)
    assert.equal(await durable.durableTryConsumePackCredit('pack-test-1'), 2)
    assert.equal(await durable.durableTryConsumePackCredit('pack-test-1'), 1)
    assert.equal(await durable.durableTryConsumePackCredit('pack-test-1'), 0)
    assert.equal(await durable.durableTryConsumePackCredit('pack-test-1'), null)
  })
})
