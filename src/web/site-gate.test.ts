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
})

describe('site-gate sessionSeal', () => {
  it('omits ownerToken from seal payload (v2)', () => {
    const applied = siteGateApply({
      policyId: 'seal-v2-a',
      ownerId: 'owner-a',
      policy: DEMO_POLICY,
    })
    assert.ok(applied.ownerToken)
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

  it('rejects stale seal after ledger advances', () => {
    const policyId = 'seal-stale-a'
    const applied = siteGateApply({
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

    const allowed = siteGateEvaluate({
      policyId,
      sessionSeal: staleSeal,
      intent: {
        action: 'transfer',
        amountUsd: 1,
        symbol: 'USDC',
        toAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        chainId: 8453,
      },
    })
    assert.equal(allowed.decision, 'allow')
    assert.notEqual(allowed.sessionSeal, staleSeal)

    assert.throws(
      () =>
        siteGateEvaluate({
          policyId,
          sessionSeal: staleSeal,
          intent: {
            action: 'transfer',
            amountUsd: 1,
            symbol: 'USDC',
            toAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            chainId: 8453,
          },
        }),
      /stale sessionSeal/
    )
  })

  it('decode rejects tampered payload', () => {
    const applied = siteGateApply({
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
})
