import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clientIp } from './abuse-guard.js'

describe('clientIp', () => {
  it('prefers the Vercel header over a spoofed forwarded-for', () => {
    assert.equal(
      clientIp({
        headers: {
          'x-forwarded-for': '1.2.3.4, 10.0.0.1',
          'x-vercel-forwarded-for': '203.0.113.8',
        },
      }),
      '203.0.113.8'
    )
  })

  it('falls back to x-forwarded-for off Vercel', () => {
    assert.equal(
      clientIp({ headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' } }),
      '198.51.100.4'
    )
  })
})
