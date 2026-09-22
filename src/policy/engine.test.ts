/**
 * Gate + receipt unit tests (no network).
 *   npm test
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

process.env.ALLOWLATCH_TENANT_AUTH = '0'
process.env.ALLOWLATCH_RECEIPT_SECRET = 'test-secret-allowlatch'

import { DEMO_POLICY, type SpendIntent } from './schema.js'
import { commitIntent, evaluateIntent, freshLedger } from './engine.js'
import {
  hashAction,
  issueAllowReceipt,
  verifyAllowReceipt,
} from '../billing/receipt.js'
import { PolicyStore } from '../store/fs-store.js'
import { AuthError, assertPolicyWrite, hashOwnerToken, mintOwnerToken } from '../auth/tenant.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const router = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'

/** USDC transfer/x402 helper — amountUsd alone is not binding. */
function usdcIntent(
  amountUsd: number,
  extra: Partial<SpendIntent> & { action?: SpendIntent['action'] } = {}
): SpendIntent {
  return {
    action: extra.action ?? 'transfer',
    amountUsd,
    symbol: 'USDC',
    tokenAmount: String(Math.round(amountUsd * 1e6)),
    toAddress: router,
    ...extra,
  }
}

describe('evaluateIntent', () => {
  it('allows a small swap under caps', () => {
    const intent: SpendIntent = {
      action: 'swap',
      amountUsd: 8,
      symbol: 'ETH',
      toAddress: router,
      contractAddress: router,
      calldataHash: '0x' + 'cd'.repeat(16),
    }
    const r = evaluateIntent(DEMO_POLICY, intent, freshLedger())
    assert.equal(r.decision, 'allow')
  })

  it('denies meme symbol', () => {
    const r = evaluateIntent(
      DEMO_POLICY,
      {
        action: 'swap',
        amountUsd: 5,
        symbol: 'PEPE',
        toAddress: router,
        calldataHash: '0x' + 'cd'.repeat(16),
      },
      freshLedger()
    )
    assert.equal(r.decision, 'deny')
  })

  it('denies swap without calldataHash', () => {
    const r = evaluateIntent(
      DEMO_POLICY,
      { action: 'swap', amountUsd: 5, symbol: 'ETH', toAddress: router },
      freshLedger()
    )
    assert.equal(r.decision, 'deny')
    assert.match(r.reasons.join(' '), /calldataHash/i)
  })

  it('escalates above human threshold', () => {
    const r = evaluateIntent(DEMO_POLICY, usdcIntent(10.5, { action: 'x402_pay' }), freshLedger())
    assert.equal(r.decision, 'escalate')
  })

  it('enforces lifetime wallet budget', () => {
    const ledger = { ...freshLedger(), spentUsdLifetime: 190 }
    const r = evaluateIntent(DEMO_POLICY, usdcIntent(15), ledger)
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
      usdcIntent(1, { functionSelector: '0x095ea7b3' }),
      freshLedger()
    )
    assert.equal(r.decision, 'deny')
  })

  it('commits lifetime spend', () => {
    const next = commitIntent(freshLedger(), usdcIntent(3))
    assert.equal(next.spentUsdToday, 3)
    assert.equal(next.spentUsdLifetime, 3)
  })

  it('denies wrong chainId', () => {
    const r = evaluateIntent(DEMO_POLICY, usdcIntent(2, { chainId: 1 }), freshLedger())
    assert.equal(r.decision, 'deny')
    assert.match(r.reasons.join(' '), /chainId/i)
  })

  it('allows matching Base chainId', () => {
    const r = evaluateIntent(DEMO_POLICY, usdcIntent(2, { chainId: 8453 }), freshLedger())
    assert.equal(r.decision, 'allow')
  })

  it('denies USDC transfer without tokenAmount binding', () => {
    const r = evaluateIntent(
      DEMO_POLICY,
      { action: 'transfer', amountUsd: 2, symbol: 'USDC', toAddress: router },
      freshLedger()
    )
    assert.equal(r.decision, 'deny')
    assert.match(r.reasons.join(' '), /tokenAmount|calldata/i)
  })

  it('denies tokenAmount that disagrees with amountUsd', () => {
    const r = evaluateIntent(
      DEMO_POLICY,
      usdcIntent(2, { tokenAmount: '999' }),
      freshLedger()
    )
    assert.equal(r.decision, 'deny')
    assert.match(r.reasons.join(' '), /does not match amountUsd/i)
  })

  it('denies fake USDC token contract', () => {
    const r = evaluateIntent(
      DEMO_POLICY,
      usdcIntent(2, { tokenAddress: '0x000000000000000000000000000000000000dead' }),
      freshLedger()
    )
    assert.equal(r.decision, 'deny')
    assert.match(r.reasons.join(' '), /canonical USDC/i)
  })

  it('denies token not on token allowlist', () => {
    const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const policy = {
      ...DEMO_POLICY,
      universe: {
        ...DEMO_POLICY.universe,
        allowedTokenAddresses: [usdc],
      },
    }
    const r = evaluateIntent(
      policy,
      {
        action: 'transfer',
        amountUsd: 2,
        symbol: 'ETH',
        tokenAddress: '0x4200000000000000000000000000000000000006',
        toAddress: router,
      },
      freshLedger()
    )
    assert.equal(r.decision, 'deny')
    assert.match(r.reasons.join(' '), /token allowlist/i)
  })
})

describe('allow-receipt', () => {
  it('issues and verifies action-bound receipt', () => {
    const intent = usdcIntent(2, { calldataHash: '0x' + 'ab'.repeat(16), reason: 'ignored in digest' })
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
    assert.equal(receipt!.chain, 'base')
    const ok = verifyAllowReceipt(receipt!, { policy: DEMO_POLICY, intent })
    assert.equal(ok.ok, true)
  })

  it('rejects chain-mismatched receipt', () => {
    const intent = usdcIntent(2)
    const evaluation = evaluateIntent(DEMO_POLICY, intent, freshLedger())
    const receipt = issueAllowReceipt({
      policyId: 'default',
      policy: DEMO_POLICY,
      intent,
      evaluation,
    })!
    const sepoliaPolicy = { ...DEMO_POLICY, chain: 'base-sepolia' as const }
    const bad = verifyAllowReceipt(receipt, { policy: sepoliaPolicy, intent })
    assert.equal(bad.ok, false)
  })

  it('binds digest to tokenAddress and chainId', () => {
    const a = usdcIntent(2, {
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      chainId: 8453,
    })
    const b = { ...a, chainId: 84532 }
    assert.notEqual(hashAction(a), hashAction(b))
  })

  it('rejects calldata swap after issue', () => {
    const intent = usdcIntent(2, { calldataHash: '0x' + '11'.repeat(16) })
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
    const a = usdcIntent(2, { reason: 'one' })
    const b: SpendIntent = { ...a, reason: 'two' }
    assert.equal(hashAction(a), hashAction(b))
  })
})

describe('wallet-native plan', () => {
  it('plans a daily USDC spend permission from policy caps', async () => {
    process.env.ALLOWLATCH_ENFORCEMENT = 'hybrid'
    process.env.ALLOWLATCH_SMART_ACCOUNT = '0x1111111111111111111111111111111111111111'
    process.env.CDP_WALLET_ADDRESS = '0x2222222222222222222222222222222222222222'
    const { planSpendPermission } = await import('../wallet/spend-permissions.js')
    const plan = planSpendPermission({ policy: DEMO_POLICY })
    assert.equal(plan.status, 'planned')
    assert.equal(plan.periodSeconds, 86_400)
    assert.ok(BigInt(plan.allowanceAtomic) > 0n)
  })
})

describe('tenant auth + lifetime ledger', () => {
  it('requires ownerId to create and ownerToken to update', () => {
    assert.throws(
      () => assertPolicyWrite(null, {}),
      (e: unknown) => e instanceof AuthError
    )
    const token = mintOwnerToken()
    const meta = {
      policyId: 'p1',
      ownerId: 'alice',
      tokenHash: hashOwnerToken(token),
      ownerAddress: null as string | null,
    }
    assert.equal(assertPolicyWrite(meta, { ownerToken: token }).mode, 'update')
    assert.throws(
      () => assertPolicyWrite(meta, { ownerToken: 'wrong' }),
      (e: unknown) => e instanceof AuthError
    )
  })

  it('resetDailyLedger preserves lifetime spend', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'allowlatch-life-'))
    process.env.ALLOWLATCH_SQLITE_PATH = path.join(dir, 't.sqlite')
    process.env.ALLOWLATCH_TENANT_AUTH = '0'
    const store = new PolicyStore()
    await store.init()
    await store.setPolicy('life', DEMO_POLICY, 'owner', undefined, { skipAuth: true })
    await store.setLedger('life', {
      ...freshLedger(),
      spentUsdToday: 12,
      spentUsdLifetime: 90,
    })
    await store.resetDailyLedger('life')
    const led = store.getLedger('life')
    assert.equal(led.spentUsdToday, 0)
    assert.equal(led.spentUsdLifetime, 90)
  })
})
