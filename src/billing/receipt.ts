/**
 * Action-bound allow-receipt: HMAC + single-use jti + canonical action digest.
 * Digest ignores free-text reason so receipts bind to the spend, not the narrative.
 */
import { createHmac, createHash, timingSafeEqual, randomUUID } from 'node:crypto'
import type { EvaluationResult, MandatePolicy, SpendIntent } from '../policy/schema.js'

export type AllowReceipt = {
  v: 1
  decision: 'allow'
  policyId: string
  /** Single-use nonce — must be consumed exactly once at execute boundary. */
  jti: string
  policyHash: string
  /** Canonical spend digest (action/amount/to/token/contract/selector/chain/calldataHash). */
  intentHash: string
  /** Policy chain at issue time (binds receipt to Base / Base Sepolia). */
  chain: 'base' | 'base-sepolia'
  /** Echo of intent.calldataHash when set (required for swaps by the gate). Execute must re-supply the same bytes hash. */
  calldataHash?: string
  issuedAt: number
  expiresAt: number
  sig: string
}

function receiptSecret(): string {
  const dedicated = process.env.ALLOWLATCH_RECEIPT_SECRET?.trim()
  if (dedicated) return dedicated
  const isProd =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
  if (isProd) {
    throw new Error(
      'ALLOWLATCH_RECEIPT_SECRET required in production (do not reuse SERV_API_KEY for receipts)'
    )
  }
  const serv = process.env.SERV_API_KEY?.trim()
  if (serv) {
    if (!warnedServFallback) {
      warnedServFallback = true
      console.warn(
        '[receipt] ALLOWLATCH_RECEIPT_SECRET unset — falling back to SERV_API_KEY (dev only).'
      )
    }
    return serv
  }
  throw new Error('ALLOWLATCH_RECEIPT_SECRET required for receipts (prefer dedicated secret over SERV_API_KEY)')
}

let warnedServFallback = false

export function hashPolicy(policy: MandatePolicy): string {
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0, 32)
}

/**
 * Canonical action digest — binds receipt to the spend, not to reason/requestId.
 * Prefer this over hashing the full intent object.
 */
export function hashAction(intent: SpendIntent): string {
  const canonical = {
    action: intent.action,
    amountUsd: intent.amountUsd,
    symbol: intent.symbol ? intent.symbol.toUpperCase() : null,
    tokenAddress: intent.tokenAddress?.trim().toLowerCase() ?? null,
    tokenAmount: intent.tokenAmount?.trim() ?? null,
    toAddress: intent.toAddress?.trim().toLowerCase() ?? null,
    contractAddress: intent.contractAddress?.trim().toLowerCase() ?? null,
    spenderAddress: intent.spenderAddress?.trim().toLowerCase() ?? null,
    chainId: intent.chainId ?? null,
    networkId: intent.networkId?.trim().toLowerCase() ?? null,
    functionSelector: intent.functionSelector?.toLowerCase() ?? null,
    calldataHash: intent.calldataHash?.trim().toLowerCase() ?? null,
    calldata: intent.calldata?.trim().toLowerCase() ?? null,
    slippageBps: intent.slippageBps ?? null,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32)
}

/** @deprecated alias — use hashAction */
export function hashIntent(intent: SpendIntent): string {
  return hashAction(intent)
}

function signingPayload(r: Omit<AllowReceipt, 'sig'>): string {
  return [
    r.v,
    r.decision,
    r.policyId,
    r.jti,
    r.policyHash,
    r.intentHash,
    r.chain,
    r.calldataHash ?? '',
    r.issuedAt,
    r.expiresAt,
  ].join('|')
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function issueAllowReceipt(args: {
  policyId: string
  policy: MandatePolicy
  intent: SpendIntent
  evaluation: EvaluationResult
  ttlSec?: number
  jti?: string
}): AllowReceipt | null {
  if (args.evaluation.decision !== 'allow') return null
  const issuedAt = Math.floor(Date.now() / 1000)
  const ttl = args.ttlSec ?? Number(process.env.ALLOWLATCH_RECEIPT_TTL_SEC || 120)
  const intentHash = hashAction(args.intent)
  if (process.env.ALLOWLATCH_DEBUG_RECEIPT === '1') {
    console.error(
      '[receipt] issue',
      intentHash,
      JSON.stringify({
        action: args.intent.action,
        amountUsd: args.intent.amountUsd,
        symbol: args.intent.symbol,
        tokenAddress: args.intent.tokenAddress,
        toAddress: args.intent.toAddress,
        chainId: args.intent.chainId,
        networkId: args.intent.networkId,
        calldataHash: args.intent.calldataHash,
      })
    )
  }
  const body: Omit<AllowReceipt, 'sig'> = {
    v: 1,
    decision: 'allow',
    policyId: args.policyId,
    jti: args.jti ?? randomUUID(),
    policyHash: hashPolicy(args.policy),
    intentHash,
    chain: args.policy.chain,
    calldataHash: args.intent.calldataHash?.trim().toLowerCase(),
    issuedAt,
    expiresAt: issuedAt + Math.max(15, ttl),
  }
  return { ...body, sig: sign(signingPayload(body), receiptSecret()) }
}

export function verifyAllowReceipt(
  receipt: AllowReceipt,
  opts?: {
    policy?: MandatePolicy
    intent?: SpendIntent
    nowSec?: number
    /**
     * When false, skip HMAC (remote clients never have the host receipt secret).
     * Still binds expiry + optional policy/intent digests. Prefer true whenever
     * ALLOWLATCH_RECEIPT_SECRET is available (operator / same-process execute).
     */
    requireHmac?: boolean
  }
): { ok: true } | { ok: false; error: string } {
  if (receipt.v !== 1 || receipt.decision !== 'allow' || !receipt.jti) {
    return { ok: false, error: 'invalid receipt shape' }
  }
  const now = opts?.nowSec ?? Math.floor(Date.now() / 1000)
  if (now > receipt.expiresAt) return { ok: false, error: 'receipt expired' }

  const requireHmac = opts?.requireHmac !== false
  if (requireHmac) {
    const expected = sign(signingPayload(receipt), receiptSecret())
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(receipt.sig, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: 'bad signature' }
    }
  } else if (typeof receipt.sig !== 'string' || receipt.sig.length < 32) {
    return { ok: false, error: 'missing receipt signature' }
  }
  if (opts?.policy && hashPolicy(opts.policy) !== receipt.policyHash) {
    return { ok: false, error: 'policy hash mismatch' }
  }
  if (opts?.policy && receipt.chain && opts.policy.chain !== receipt.chain) {
    return { ok: false, error: 'chain mismatch' }
  }
  if (opts?.intent && hashAction(opts.intent) !== receipt.intentHash) {
    return { ok: false, error: 'intent hash mismatch' }
  }
  if (opts?.intent) {
    const intentCd = opts.intent.calldataHash?.trim().toLowerCase()
    const receiptCd = receipt.calldataHash?.trim().toLowerCase()
    if (receiptCd && intentCd !== receiptCd) {
      return { ok: false, error: 'calldata hash mismatch' }
    }
  }
  return { ok: true }
}

/** Parse unknown JSON into AllowReceipt (loose). */
export function parseAllowReceipt(raw: unknown): AllowReceipt | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.v !== 1 || r.decision !== 'allow' || typeof r.jti !== 'string') return null
  if (typeof r.sig !== 'string' || typeof r.policyId !== 'string') return null
  return r as unknown as AllowReceipt
}
