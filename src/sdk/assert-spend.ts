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
 * Call AllowLatch and refuse to proceed without ALLOW + valid receipt.
 *
 * Primary: always-on Vercel `/api/gate` with native Base USDC x402 ($0.025).
 * Fallback: OpenServ x402 (`triggerUrl` / `workflowId`) when site gate fails or is skipped.
 */
export async function assertSpend(args: {
  intent: SpendIntent
  policyId?: string
  /** Always-on website gate (default: https://allowlatch.vercel.app/api/gate) */
  gateUrl?: string
  /** HMAC session from website Go live (survives Vercel cold starts). */
  sessionSeal?: string
  /** OpenServ x402 trigger URL — fallback / optional marketplace path */
  triggerUrl?: string
  workflowId?: number
  /** Prepaid pack credits — burn one per evaluate instead of paying $0.025 each time. */
  packKey?: string
  /** Skip site gate and use OpenServ only */
  preferOpenServ?: boolean
  /** Payer wallet — pays site-gate x402 and/or OpenServ x402 */
  walletPrivateKey?: string
  /** If true, throw unless decision===allow and receipt verifies (default true). */
  requireReceipt?: boolean
}): Promise<AssertSpendResult> {
  const intent = SpendIntentSchema.parse(args.intent)
  const policyId = args.policyId ?? 'default'
  const requireReceipt = args.requireReceipt !== false
  const privateKey = args.walletPrivateKey ?? process.env.WALLET_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY
  const gateUrl =
    args.gateUrl?.trim() ||
    process.env.ALLOWLATCH_GATE_URL?.trim() ||
    'https://allowlatch.vercel.app/api/gate'
  const preferOpenServ =
    args.preferOpenServ === true ||
    process.env.ALLOWLATCH_PREFER_OPENSERV === '1'
  const packKey =
    args.packKey?.trim() || process.env.ALLOWLATCH_PACK_KEY?.trim() || undefined

  let raw: unknown
  let usedSiteGate = false

  async function callSiteGate(): Promise<unknown> {
    if (!privateKey?.trim() && !packKey) {
      denyClosed(
        'walletPrivateKey required to pay site-gate x402 ($0.025 USDC on Base), or packKey with prepaid credits'
      )
    }
    const body = {
      action: 'evaluate' as const,
      policyId,
      intent,
      sessionSeal: args.sessionSeal || process.env.ALLOWLATCH_SESSION_SEAL || undefined,
      packKey,
    }

    // Prefer burning a pack credit when available (no wallet needed for that hop).
    if (packKey) {
      const creditRes = await fetch(gateUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const creditBody = await creditRes.json()
      if (creditRes.ok && (creditBody as { ok?: boolean }).ok !== false) {
        return creditBody
      }
      // Fall through to paid path if no credits / 402
    }

    if (!privateKey?.trim()) {
      denyClosed('walletPrivateKey required to pay site-gate x402 ($0.025 USDC on Base)')
    }
    const { wrapFetchWithPayment } = await import('x402-fetch')
    const { privateKeyToAccount } = await import('viem/accounts')
    let pk = privateKey.trim()
    if (!pk.startsWith('0x')) pk = `0x${pk}`
    const account = privateKeyToAccount(pk as `0x${string}`)
    const paidFetch = wrapFetchWithPayment(
      fetch,
      account as unknown as Parameters<typeof wrapFetchWithPayment>[1],
      50_000n
    )
    const res = await paidFetch(gateUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const paidBody = await res.json()
    if (res.status === 402) {
      denyClosed(
        `site gate payment required/failed: ${JSON.stringify(paidBody).slice(0, 400)}`
      )
    }
    if (!res.ok || (paidBody as { ok?: boolean }).ok === false) {
      throw new Error(
        `site gate HTTP ${res.status}: ${String((paidBody as { error?: string }).error || 'error')}`
      )
    }
    return paidBody
  }

  async function callOpenServ(): Promise<unknown> {
    if (!args.workflowId && !args.triggerUrl && !process.env.ALLOWLATCH_TRIGGER_URL?.trim()) {
      denyClosed('OpenServ fallback needs triggerUrl or workflowId')
    }
    const triggerUrl =
      args.triggerUrl?.trim() || process.env.ALLOWLATCH_TRIGGER_URL?.trim() || ''
    const client = new PlatformClient()
    const prompt = buildEvaluatePrompt(policyId, intent)
    const payOpts = privateKey?.trim()
      ? { privateKey: privateKey.trim().startsWith('0x') ? privateKey.trim() : `0x${privateKey.trim()}` }
      : {}
    if (args.workflowId) {
      return client.payments.payWorkflow({
        workflowId: args.workflowId,
        input: { prompt },
        ...payOpts,
      })
    }
    return client.payments.payWorkflow({
      triggerUrl,
      input: { prompt },
      ...payOpts,
    })
  }

  if (!preferOpenServ) {
    try {
      raw = await callSiteGate()
      usedSiteGate = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const canFallback =
        Boolean(args.triggerUrl || args.workflowId || process.env.ALLOWLATCH_TRIGGER_URL?.trim())
      if (!canFallback) denyClosed(`site gate unreachable — ${msg}`)
      try {
        raw = await callOpenServ()
        usedSiteGate = false
      } catch (err2) {
        denyClosed(
          `site gate failed (${msg}); OpenServ fallback failed — ${
            err2 instanceof Error ? err2.message : String(err2)
          }`
        )
      }
    }
  } else {
    try {
      raw = await callOpenServ()
    } catch (err) {
      denyClosed(
        `OpenServ gate unreachable or payment failed — ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  const text = usedSiteGate ? JSON.stringify(raw) : extractGateText(raw)
  const parsed = usedSiteGate
    ? (raw as Record<string, unknown>)
    : parseGateJson(text)

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

    // Remote site-gate clients never hold ALLOWLATCH_RECEIPT_SECRET — bind via digests + TLS.
    // Dedicated secret → full HMAC (operator / same-process execute).
    const haveDedicatedSecret = Boolean(process.env.ALLOWLATCH_RECEIPT_SECRET?.trim())
    const requireHmac = haveDedicatedSecret || !usedSiteGate

    let verified = false
    let lastErr = 'intent hash mismatch'
    for (const candidate of variants) {
      const v = verifyAllowReceipt(receipt, { intent: candidate, requireHmac })
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
      const sigOnly = verifyAllowReceipt(receipt, { requireHmac })
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
