/**
 * Short-lived allow-receipt: agents should refuse to sign without a valid receipt.
 * HMAC over canonical payload; secret = SPENDGATE_RECEIPT_SECRET or SERV_API_KEY.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import type { EvaluationResult, MandatePolicy, SpendIntent } from '../policy/schema.js'

export type AllowReceipt = {
  v: 1
  decision: 'allow'
  policyId: string
  policyHash: string
  intentHash: string
  issuedAt: number
  expiresAt: number
  sig: string
}

function receiptSecret(): string {
  const s =
    process.env.SPENDGATE_RECEIPT_SECRET?.trim() ||
    process.env.SERV_API_KEY?.trim() ||
    ''
  if (!s) throw new Error('SPENDGATE_RECEIPT_SECRET or SERV_API_KEY required for receipts')
  return s
}

export function hashPolicy(policy: MandatePolicy): string {
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0, 32)
}

export function hashIntent(intent: SpendIntent): string {
  return createHash('sha256').update(JSON.stringify(intent)).digest('hex').slice(0, 32)
}

function signingPayload(r: Omit<AllowReceipt, 'sig'>): string {
  return [
    r.v,
    r.decision,
    r.policyId,
    r.policyHash,
    r.intentHash,
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
}): AllowReceipt | null {
  if (args.evaluation.decision !== 'allow') return null
  const issuedAt = Math.floor(Date.now() / 1000)
  const ttl = args.ttlSec ?? Number(process.env.SPENDGATE_RECEIPT_TTL_SEC || 60)
  const body: Omit<AllowReceipt, 'sig'> = {
    v: 1,
    decision: 'allow',
    policyId: args.policyId,
    policyHash: hashPolicy(args.policy),
    intentHash: hashIntent(args.intent),
    issuedAt,
    expiresAt: issuedAt + Math.max(15, ttl),
  }
  return { ...body, sig: sign(signingPayload(body), receiptSecret()) }
}

export function verifyAllowReceipt(
  receipt: AllowReceipt,
  opts?: { policy?: MandatePolicy; intent?: SpendIntent; nowSec?: number }
): { ok: true } | { ok: false; error: string } {
  if (receipt.v !== 1 || receipt.decision !== 'allow') {
    return { ok: false, error: 'invalid receipt shape' }
  }
  const now = opts?.nowSec ?? Math.floor(Date.now() / 1000)
  if (now > receipt.expiresAt) return { ok: false, error: 'receipt expired' }

  const expected = sign(signingPayload(receipt), receiptSecret())
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(receipt.sig, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'bad signature' }
  }
  if (opts?.policy && hashPolicy(opts.policy) !== receipt.policyHash) {
    return { ok: false, error: 'policy hash mismatch' }
  }
  if (opts?.intent && hashIntent(opts.intent) !== receipt.intentHash) {
    return { ok: false, error: 'intent hash mismatch' }
  }
  return { ok: true }
}
