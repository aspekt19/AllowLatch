/**
 * Gate + receipt unit tests (no network).
 *   npm test
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_POLICY, type SpendIntent } from './schema.js'
import { commitIntent, evaluateIntent, freshLedger } from './engine.js'
import {
  hashAction,
  issueAllowReceipt,
  verifyAllowReceipt,
} from '../billing/receipt.js'

process.env.ALLOWLATCH_RECEIPT_SECRET = 'test-secret-allowlatch'

const router = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'

describe('evaluateIntent', () => {
  it('allows a small swap under caps', () => {
    const intent: SpendIntent = {
      action: 'swap',
      amountUsd: 8,
      symbol: 'ETH',
      toAddress: router,
    }
    const r = evaluateIntent(DEMO_POLICY, intent, freshLedger())
    assert.equal(r.decision, 'allow')
  })

  it('denies meme symbol', () => {
    const r = evaluateIntent(
      DEMO_POLICY,
      { action: 'swap', amountUsd: 5, symbol: 'PEPE', toAddress: router },
      freshLedger()
    )
    assert.equal(r.decision, 'deny')
  })

  it('escalates above human threshold', () => {
    const r = evaluateIntent(
      DEMO_POLICY,
      { action: 'x402_pay', amountUsd: 10.5, toAddress: router },
      freshLedger()
    )
    assert.equal(r.decision, 'escalate')
  })

  it('enforces lifetime wallet budget', () => {
    const ledger = { ...freshLedger(), spentUsdLifetime: 190 }
    const r = evaluateIntent(
      DEMO_POLICY,
      { action: 'transfer', amountUsd: 15, toAddress: router },
      ledger
    )
    assert.equal(r.decision, 'deny')
    assert.match(r.reasons.join(' '), /lifetime wallet budget/i)
  })

  it('denies unknown function selector when allowlist set', () => {
    const policy = {
      ...DEMO_POLICY,
      universe: {
        ...DEMO_POLICY.universe,
        allowedFunctionSelectors: ['0xa9059cbb'],
      },
    }
    const r = evaluateIntent(
      policy,
      {
        action: 'transfer',
        amountUsd: 1,
        toAddress: router,
        functionSelector: '0x095ea7b3',
      },
      freshLedger()
    )
    assert.equal(r.decision, 'deny')
  })

  it('commits lifetime spend', () => {
    const next = commitIntent(freshLedger(), {
      action: 'transfer',
      amountUsd: 3,
      toAddress: router,
    })
    assert.equal(next.spentUsdToday, 3)
    assert.equal(next.spentUsdLifetime, 3)
  })
})

describe('allow-receipt', () => {
  it('issues and verifies action-bound receipt', () => {
    const intent: SpendIntent = {
      action: 'transfer',
      amountUsd: 2,
      toAddress: router,
      calldataHash: '0x' + 'ab'.repeat(16),
      reason: 'ignored in digest',
    }
    const evaluation = evaluateIntent(DEMO_POLICY, intent, freshLedger())
    assert.equal(evaluation.decision, 'allow')
    const receipt = issueAllowReceipt({
      policyId: 'default',
      policy: DEMO_POLICY,
      intent,
      evaluation,
    })
    assert.ok(receipt)
    assert.equal(receipt!.intentHash, hashAction(intent))
    assert.equal(receipt!.calldataHash, intent.calldataHash)
    const ok = verifyAllowReceipt(receipt!, { policy: DEMO_POLICY, intent })
    assert.equal(ok.ok, true)
  })

  it('rejects calldata swap after issue', () => {
    const intent: SpendIntent = {
      action: 'transfer',
      amountUsd: 2,
      toAddress: router,
      calldataHash: '0x' + '11'.repeat(16),
    }
    const evaluation = evaluateIntent(DEMO_POLICY, intent, freshLedger())
    const receipt = issueAllowReceipt({
      policyId: 'default',
      policy: DEMO_POLICY,
      intent,
      evaluation,
    })!
    const tampered = { ...intent, calldataHash: '0x' + '22'.repeat(16) }
    const bad = verifyAllowReceipt(receipt, { policy: DEMO_POLICY, intent: tampered })
    assert.equal(bad.ok, false)
  })

  it('ignores reason changes in action digest', () => {
    const a: SpendIntent = {
      action: 'transfer',
      amountUsd: 2,
      toAddress: router,
      reason: 'one',
    }
    const b: SpendIntent = { ...a, reason: 'two' }
    assert.equal(hashAction(a), hashAction(b))
  })
})
