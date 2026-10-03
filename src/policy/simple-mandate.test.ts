import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseAddressLines,
  simpleRulesToMandateText,
  validateSimpleRules,
} from './simple-mandate.js'

const ADDR = '0x5cc0Aa9ed773F413f81f78a62F2e94109CE26205'

describe('simple-mandate', () => {
  it('parses and dedupes addresses', () => {
    const list = parseAddressLines(`${ADDR}\n${ADDR.toLowerCase()}\nbad\n0x1111111111111111111111111111111111111111`)
    assert.equal(list.length, 2)
    assert.equal(list[0], ADDR)
  })

  it('rejects empty allowlist', () => {
    assert.match(
      validateSimpleRules({ dailyUsd: 20, maxPerTransferUsd: 5, addresses: [] }) ?? '',
      /address/i
    )
  })

  it('builds SERV-safe NL mandate', () => {
    const text = simpleRulesToMandateText({
      budgetUsd: 100,
      dailyUsd: 20,
      maxPerTransferUsd: 5,
      addresses: [ADDR],
      escalateAboveUsd: 2,
    })
    assert.match(text, /Budget \$100/)
    assert.match(text, /\$20/)
    assert.match(text, /\$5/)
    assert.match(text, /No swaps/)
    assert.match(text, new RegExp(ADDR, 'i'))
    assert.match(text, /Escalate above \$2/)
  })

  it('rejects budget below daily', () => {
    assert.match(
      validateSimpleRules({
        budgetUsd: 10,
        dailyUsd: 20,
        maxPerTransferUsd: 5,
        addresses: [ADDR],
      }) ?? '',
      /budget/i
    )
  })
})
