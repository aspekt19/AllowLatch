import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import {
  decodeSessionSeal,
  encodeSessionSeal,
  siteGateApply,
  siteGateEvaluate,
} from './site-gate.js'
import { DEMO_POLICY } from '../policy/schema.js'

before(() => {
  process.env.ALLOWLATCH_RECEIPT_SECRET = 'test-site-gate-receipt-secret'
  delete process.env.ALLOWLATCH_TURSO_DATABASE_URL
  delete process.env.TURSO_DATABASE_URL
})

describe('site-gate sessionSeal', () => {
  it('omits ownerToken from seal payload (v2)', async () => {
    const applied = await siteGateApply({
      policyId: 'seal-v2-a',
      ownerId: 'owner-a',
      policy: DEMO_POLICY,
    })
    assert.ok(applied.ownerToken)
    assert.equal(applied.durable, false)
    const [payload] = applied.sessionSeal.split('.')
    const raw = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    assert.equal(raw.v, 2)
    assert.equal(raw.ownerToken, undefined)
    assert.equal(typeof raw.ownerTokenHash, 'string')
    assert.ok(String(raw.ownerTokenHash).length >= 32)
  })

  it('rejects stale seal after ledger advances', async () => {
    const policyId = 'seal-stale-a'
    const applied = await siteGateApply({
      policyId,
      ownerId: 'owner-b',
      policy: {
        ...DEMO_POLICY,
        universe: {
          ...DEMO_POLICY.universe,
          allowedAddresses: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
        },
        escalation: { requireHumanConfirmAboveUsd: 100 },
      },
    })
    const staleSeal = applied.sessionSeal

    const allowed = await siteGateEvaluate({
      policyId,
      sessionSeal: staleSeal,
      intent: {
        action: 'transfer',
        amountUsd: 1,
        symbol: 'USDC',
        tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        tokenAmount: '1000000',
        toAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        chainId: 8453,
      },
    })
    assert.equal(allowed.decision, 'allow')
    assert.notEqual(allowed.sessionSeal, staleSeal)

    await assert.rejects(
      () =>
        siteGateEvaluate({
          policyId,
          sessionSeal: staleSeal,
          intent: {
            action: 'transfer',
            amountUsd: 1,
            symbol: 'USDC',
            tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
            tokenAmount: '1000000',
            toAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            chainId: 8453,
          },
        }),
      /stale sessionSeal/
    )
  })

  it('decode rejects tampered payload', async () => {
    const applied = await siteGateApply({
      policyId: 'seal-tamper',
      ownerId: 'owner-c',
      policy: DEMO_POLICY,
    })
    const [payload, sig] = applied.sessionSeal.split('.')
    const raw = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as {
      ownerId: string
    }
    raw.ownerId = 'attacker'
    const evil = `${Buffer.from(JSON.stringify(raw)).toString('base64url')}.${sig}`
    assert.equal(decodeSessionSeal(evil), null)
  })

  it('encodeSessionSeal is deterministic for same session fields', async () => {
    const applied = await siteGateApply({
      policyId: 'seal-det',
      ownerId: 'owner-d',
      policy: DEMO_POLICY,
    })
    const again = encodeSessionSeal({
      policyId: applied.policyId,
      ownerId: applied.ownerId,
      ownerToken: applied.ownerToken,
      policy: applied.policy,
      ledger: decodeSessionSeal(applied.sessionSeal)!.ledger!,
      seq: decodeSessionSeal(applied.sessionSeal)!.seq,
      updatedAt: decodeSessionSeal(applied.sessionSeal)!.updatedAt,
    })
    assert.equal(again, applied.sessionSeal)
  })
})
