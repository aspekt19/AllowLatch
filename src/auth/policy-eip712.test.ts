/**
 * EIP-712 MandatePolicyApply tests.
 */
process.env.ALLOWLATCH_TENANT_AUTH = '1'
process.env.ALLOWLATCH_RECEIPT_SECRET = 'test-secret-eip712'

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { DEMO_POLICY } from '../policy/schema.js'
import {
  assertOwnerPolicySig,
  buildPolicyApplyTypedData,
  policyHashBytes32,
} from './policy-eip712.js'
import { AuthError } from './tenant.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('policy EIP-712', () => {
  let PolicyStore: typeof import('../store/fs-store.js').PolicyStore

  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'al-eip712-'))
    process.env.ALLOWLATCH_SQLITE_PATH = path.join(dir, 't.sqlite')
    ;({ PolicyStore } = await import('../store/fs-store.js'))
  })

  it('recovers signer and binds ownerAddress on apply', async () => {
    const pk = generatePrivateKey()
    const account = privateKeyToAccount(pk)
    const policyId = 'eip712-demo'
    const ownerId = account.address
    const policy = { ...DEMO_POLICY, ownerId, name: 'EIP712 Demo' }

    const typed = buildPolicyApplyTypedData({ policyId, policy, ownerId })
    const ownerSig = await account.signTypedData({
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
    })

    const verified = await assertOwnerPolicySig({
      policyId,
      policy,
      ownerId,
      ownerAddress: account.address,
      ownerSig,
    })
    assert.equal(verified.verified, true)
    assert.equal(verified.ownerAddress?.toLowerCase(), account.address.toLowerCase())

    const store = new PolicyStore()
    await store.init()
    const applied = await store.setPolicy(policyId, policy, ownerId, {
      ownerId,
      ownerAddress: account.address,
      ownerSig,
    })
    assert.ok(applied.ownerToken)
    assert.equal(applied.ownerAddress?.toLowerCase(), account.address.toLowerCase())

    const bumped = { ...policy, capital: { ...policy.capital, maxPerOrderUsd: 9 } }
    const typed2 = buildPolicyApplyTypedData({ policyId, policy: bumped, ownerId })
    const sig2 = await account.signTypedData({
      domain: typed2.domain,
      types: typed2.types,
      primaryType: typed2.primaryType,
      message: typed2.message,
    })
    const updated = await store.setPolicy(policyId, bumped, ownerId, {
      ownerId,
      ownerSig: sig2,
    })
    assert.equal(updated.mode, 'update')
    assert.equal(store.getPolicy(policyId).capital.maxPerOrderUsd, 9)
    assert.ok(policyHashBytes32(bumped).startsWith('0x'))
  })

  it('rejects wrong signer', async () => {
    const a = privateKeyToAccount(generatePrivateKey())
    const b = privateKeyToAccount(generatePrivateKey())
    const policy = { ...DEMO_POLICY, ownerId: a.address }
    const typed = buildPolicyApplyTypedData({
      policyId: 'x',
      policy,
      ownerId: a.address,
    })
    const sig = await b.signTypedData({
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
    })
    await assert.rejects(
      () =>
        assertOwnerPolicySig({
          policyId: 'x',
          policy,
          ownerId: a.address,
          ownerAddress: a.address,
          ownerSig: sig,
        }),
      AuthError
    )
  })
})
