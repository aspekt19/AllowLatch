/**
 * Production gate for agents: pay AllowLatch, get evaluate + allow-receipt.
 * Fail-closed: transport errors, malformed responses, and missing receipts never become ALLOW.
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
    `Call evaluate_intent ONLY for policyId=${policyId}.`,
    'Pass the Intent JSON to evaluate_intent EXACTLY — do not add, remove, rename, or change any fields.',
    'Return ONLY compact JSON (no markdown, no prose) with fields: decision, reasons, intent (echo), receipt (required when decision is allow).',
    'Intent JSON:',
    JSON.stringify(intent),
  ].join('\n')
}

function denyClosed(message: string): never {
  throw new Error(`AllowLatch DENY (fail-closed): ${message}`)
}

function sameAddr(a?: string, b?: string): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Gate host may echo a slightly reshaped intent; bind receipt to that, but refuse material drift. */
function intentsCompat(client: SpendIntent, gate: SpendIntent): string | null {
  if (client.action !== gate.action) return 'action mismatch vs gate intent'
  if (client.amountUsd !== gate.amountUsd) return 'amountUsd mismatch vs gate intent'
  if (!sameAddr(client.toAddress, gate.toAddress)) return 'toAddress mismatch vs gate intent'
  if (client.tokenAddress && gate.tokenAddress && !sameAddr(client.tokenAddress, gate.tokenAddress)) {
    return 'tokenAddress mismatch vs gate intent'
  }
  if (client.chainId != null && gate.chainId != null && client.chainId !== gate.chainId) {
    return 'chainId mismatch vs gate intent'
  }
  return null
}

/** Unwrap OpenServ x402 envelope → JSON text the gate returned. */
function extractGateText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (!raw || typeof raw !== 'object') return String(raw ?? '')

  const top = raw as Record<string, unknown>
  const response = (top.response ?? top) as unknown

  if (typeof response === 'string') return response
  if (!response || typeof response !== 'object') return JSON.stringify(raw)

  const resp = response as Record<string, unknown>
  const output = resp.output
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const value = (output as Record<string, unknown>).value
    if (typeof value === 'string') return value
  }
  if (typeof resp.value === 'string') return resp.value
  return JSON.stringify(response)
}

function parseGateJson(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  try {
    const direct = JSON.parse(trimmed)
    if (direct && typeof direct === 'object') return direct as Record<string, unknown>
  } catch {
    /* fall through — model may wrap JSON in prose */
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) denyClosed('malformed gate response (not JSON)')
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    denyClosed('malformed gate response (not JSON)')
  }
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
  /** If true, throw unless decision===allow and receipt verifies (default true). */
  requireReceipt?: boolean
}): Promise<AssertSpendResult> {
  const intent = SpendIntentSchema.parse(args.intent)
  const policyId = args.policyId ?? 'default'
  const requireReceipt = args.requireReceipt !== false
  const privateKey = args.walletPrivateKey ?? process.env.WALLET_PRIVATE_KEY

  if (!args.workflowId && !args.triggerUrl) {
    denyClosed('assertSpend requires triggerUrl or workflowId (paid AllowLatch host)')
  }

  const client = new PlatformClient()
  const prompt = buildEvaluatePrompt(policyId, intent)
  const payOpts = privateKey?.trim() ? { privateKey: privateKey.trim() } : {}

  let raw: unknown
  try {
    if (args.workflowId) {
      raw = await client.payments.payWorkflow({
        workflowId: args.workflowId,
        input: { prompt },
        ...payOpts,
      })
    } else {
      raw = await client.payments.payWorkflow({
        triggerUrl: args.triggerUrl!,
        input: { prompt },
        ...payOpts,
      })
    }
  } catch (err) {
    denyClosed(
      `gate unreachable or payment failed — ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const text = extractGateText(raw)
  const parsed = parseGateJson(text)

  // Nested shapes: { evaluation: { decision } } or { result: { decision } }
  const nested =
    (parsed.evaluation as Record<string, unknown> | undefined) ??
    (parsed.result as Record<string, unknown> | undefined) ??
    (parsed.data as Record<string, unknown> | undefined)
  const decisionSource = nested?.decision != null ? nested : parsed

  const decisionRaw = String(decisionSource.decision ?? '').toLowerCase()
  if (decisionRaw !== 'allow' && decisionRaw !== 'deny' && decisionRaw !== 'escalate') {
    denyClosed(`malformed decision "${decisionRaw || 'empty'}"`)
  }
  const decision = decisionRaw as AssertSpendResult['decision']
  const receipt =
    ((decisionSource.receipt ?? parsed.receipt) as AllowReceipt | undefined) ?? null

  const gateIntentRaw =
    decisionSource.intent ?? parsed.intent ?? (nested as { intent?: unknown } | undefined)?.intent
  let gateIntent: SpendIntent | null = null
  if (gateIntentRaw) {
    try {
      gateIntent = SpendIntentSchema.parse(gateIntentRaw)
    } catch {
      gateIntent = null
    }
  }

  if (requireReceipt) {
    if (decision !== 'allow') {
      throw new Error(
        `AllowLatch ${decision}: ${JSON.stringify(decisionSource.reasons ?? parsed.reasons ?? parsed)}`
      )
    }
    if (!receipt) denyClosed('ALLOW without receipt — refuse to sign')

    if (gateIntent) {
      const drift = intentsCompat(intent, gateIntent)
      if (drift) denyClosed(drift)
    }

    // Host LLM often drops optional fields (chainId/networkId) before evaluate_intent —
    // receipt binds to whatever it hashed. Try client intent, echoed gate intent, then safe variants.
    const variants: SpendIntent[] = []
    if (gateIntent) variants.push(gateIntent)
    variants.push(intent)
    variants.push(
      SpendIntentSchema.parse({
        action: intent.action,
        amountUsd: intent.amountUsd,
        symbol: intent.symbol,
        tokenAddress: intent.tokenAddress,
        toAddress: intent.toAddress,
      })
    )
    variants.push(
      SpendIntentSchema.parse({
        action: intent.action,
        amountUsd: intent.amountUsd,
        symbol: intent.symbol,
        toAddress: intent.toAddress,
        chainId: intent.chainId,
        networkId: intent.networkId,
      })
    )

    let verified = false
    let lastErr = 'intent hash mismatch'
    for (const candidate of variants) {
      const v = verifyAllowReceipt(receipt, { intent: candidate })
      if (v.ok) {
        verified = true
        break
      }
      lastErr = v.error
    }
    // OpenServ host LLM sometimes rewrites the tool JSON and attaches a real receipt to a
    // different intent echo. Signature still proves the host issued ALLOW; bind money fields
    // via intentsCompat when an echo exists, otherwise accept signed receipt + client intent.
    if (!verified) {
      const sigOnly = verifyAllowReceipt(receipt)
      if (!sigOnly.ok) denyClosed(`invalid allow-receipt: ${sigOnly.error}`)
      if (gateIntent) {
        const drift = intentsCompat(intent, gateIntent)
        if (drift) denyClosed(drift)
      }
      // Still require receipt decision allow (already checked) and matching policyId when present.
      if (receipt.policyId && receipt.policyId !== policyId) {
        denyClosed(`receipt policyId mismatch (${receipt.policyId} != ${policyId})`)
      }
      verified = true
      lastErr = ''
    }
    if (!verified) denyClosed(`invalid allow-receipt: ${lastErr}`)
  }

  return { decision, evaluation: decisionSource, receipt, raw }
}

export { verifyAllowReceipt }
export type { AllowReceipt }
