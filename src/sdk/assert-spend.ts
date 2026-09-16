/**
 * Production gate for agents: pay AllowLatch, get evaluate + allow-receipt.
 * Do not use local JSON as the source of truth for live spends.
 */
import { PlatformClient } from '@openserv-labs/client'
import { SpendIntentSchema, type SpendIntent } from '../policy/schema.js'
import type { AllowReceipt } from '../billing/receipt.js'
import { verifyAllowReceipt } from '../billing/receipt.js'

export type AssertSpendResult = {
  decision: 'allow' | 'deny' | 'escalate'
  evaluation: unknown
  receipt: AllowReceipt | null
  raw: unknown
}

function buildEvaluatePrompt(policyId: string, intent: SpendIntent): string {
  return [
    `evaluate_intent for policyId=${policyId}`,
    'Return the JSON evaluation. If ALLOW, include allow-receipt.',
    'Intent JSON:',
    JSON.stringify(intent),
  ].join('\n')
}

/**
 * Call AllowLatch over x402 and refuse to proceed without ALLOW + valid receipt.
 */
export async function assertSpend(args: {
  intent: SpendIntent
  policyId?: string
  /** OpenServ x402 trigger URL (from discoverServices().webhookUrl) */
  triggerUrl?: string
  workflowId?: number
  /** Payer wallet — required for programmatic x402 */
  walletPrivateKey?: string
  /** If true, throw unless decision===allow and receipt verifies */
  requireReceipt?: boolean
}): Promise<AssertSpendResult> {
  const intent = SpendIntentSchema.parse(args.intent)
  const policyId = args.policyId ?? 'default'
  const requireReceipt = args.requireReceipt !== false
  const privateKey = args.walletPrivateKey ?? process.env.WALLET_PRIVATE_KEY

  const client = new PlatformClient()
  const prompt = buildEvaluatePrompt(policyId, intent)
  const payOpts = privateKey?.trim() ? { privateKey: privateKey.trim() } : {}

  let raw: unknown
  if (args.workflowId) {
    raw = await client.payments.payWorkflow({
      workflowId: args.workflowId,
      input: { prompt },
      ...payOpts,
    })
  } else if (args.triggerUrl) {
    raw = await client.payments.payWorkflow({
      triggerUrl: args.triggerUrl,
      input: { prompt },
      ...payOpts,
    })
  } else {
    throw new Error('assertSpend requires triggerUrl or workflowId (paid AllowLatch host)')
  }

  const paid = raw as { response?: unknown }
  const payload = paid.response ?? raw
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)

  let parsed: Record<string, unknown> = {}
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    parsed = { raw: text }
  }

  const decision = String(parsed.decision ?? '').toLowerCase() as AssertSpendResult['decision']
  const receipt = (parsed.receipt as AllowReceipt | undefined) ?? null

  if (requireReceipt) {
    if (decision !== 'allow') {
      throw new Error(`AllowLatch ${decision || 'unknown'}: ${JSON.stringify(parsed.reasons ?? parsed)}`)
    }
    if (!receipt) throw new Error('ALLOW without receipt — refuse to sign')
    const v = verifyAllowReceipt(receipt, { intent })
    if (!v.ok) throw new Error(`Invalid allow-receipt: ${v.error}`)
  }

  return { decision: decision || 'deny', evaluation: parsed, receipt, raw }
}

export { verifyAllowReceipt }
export type { AllowReceipt }
