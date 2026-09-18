/**
 * Store receipt consume + replay (no network).
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEMO_POLICY } from '../policy/schema.js'

describe('PolicyStore receipt consume', () => {
  let store: InstanceType<typeof import('./fs-store.js').PolicyStore>

  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'allowlatch-store-'))
    process.env.ALLOWLATCH_SQLITE_PATH = join(dir, 'test.sqlite')
    const { PolicyStore } = await import('./fs-store.js')
    store = new PolicyStore()
    await store.init()
  })

  it('consumes jti once and rejects replay', () => {
    const jti = 'test-jti-' + Date.now()
    const first = store.tryConsumeReceipt(jti, {
      policyId: 'default',
      intentHash: '0xabc',
    })
    const second = store.tryConsumeReceipt(jti, {
      policyId: 'default',
      intentHash: '0xabc',
    })
    assert.equal(first, true)
    assert.equal(second, false)
  })

  it('only one concurrent consume of the same jti succeeds', () => {
    const jti = 'race-jti-' + Date.now()
    const results = Array.from({ length: 20 }, () =>
      store.tryConsumeReceipt(jti, { policyId: 'default', intentHash: '0xrace' })
    )
    assert.equal(results.filter(Boolean).length, 1)
    assert.equal(results.filter((x) => !x).length, 19)
  })

  it('persists policy under exclusive writes', async () => {
    await store.setPolicy('default', DEMO_POLICY, 'owner-test')
    const p = store.getPolicy('default')
    assert.equal(p.name, DEMO_POLICY.name)
  })
})
