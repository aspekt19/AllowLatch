/**
 * Website product gate — deterministic engine + allow-receipt on Vercel.
 * Sessions survive cold starts via HMAC-signed sessionSeal held by the browser.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  MandatePolicySchema,
  SpendLedgerSchema,
  type MandatePolicy,
  type SpendIntent,
  type SpendLedger,
} from '../policy/schema.js'
import { commitIntent, evaluateIntent, freshLedger } from '../policy/engine.js'
import { issueAllowReceipt } from '../billing/receipt.js'

type Session = {
  policyId: string
  ownerId: string
  ownerToken: string
  policy: MandatePolicy
  ledger: SpendLedger
  updatedAt: number
}

const TTL_MS = 1000 * 60 * 60 * 12 // 12h
const sessions = new Map<string, Session>()

function sealSecret(): string {
  return (
    process.env.ALLOWLATCH_RECEIPT_SECRET?.trim() ||
    process.env.SERV_API_KEY?.trim() ||
    ''
  )
}

function prune() {
  const now = Date.now()
  for (const [k, s] of sessions) {
    if (now - s.updatedAt > TTL_MS) sessions.delete(k)
  }
}

function signSealPayload(payload: string): string {
  return createHmac('sha256', sealSecret()).update(payload).digest('hex')
}

export function encodeSessionSeal(session: Session): string {
  const body = {
    v: 1 as const,
    policyId: session.policyId,
    ownerId: session.ownerId,
    ownerToken: session.ownerToken,
    policy: session.policy,
    ledger: session.ledger,
    updatedAt: session.updatedAt,
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')
  const sig = signSealPayload(payload)
  return `${payload}.${sig}`
}

export function decodeSessionSeal(seal: string | undefined): Session | null {
  if (!seal?.trim() || !sealSecret()) return null
  const [payload, sig] = seal.trim().split('.')
  if (!payload || !sig) return null
  const expected = signSealPayload(payload)
  try {
    const a = Buffer.from(sig, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      v?: number
      policyId?: string
      ownerId?: string
      ownerToken?: string
      policy?: unknown
      ledger?: unknown
      updatedAt?: number
    }
    if (raw.v !== 1 || !raw.policyId || !raw.ownerId || !raw.ownerToken) return null
    if (typeof raw.updatedAt !== 'number' || Date.now() - raw.updatedAt > TTL_MS) return null
    const policy = MandatePolicySchema.parse(raw.policy)
    const ledger = SpendLedgerSchema.parse(raw.ledger ?? freshLedger())
    return {
      policyId: raw.policyId,
      ownerId: raw.ownerId,
      ownerToken: raw.ownerToken,
      policy,
      ledger,
      updatedAt: raw.updatedAt,
    }
  } catch {
    return null
  }
}

function resolveSession(args: {
  policyId: string
  sessionSeal?: string
}): Session {
  prune()
  const sealed = decodeSessionSeal(args.sessionSeal)
  if (sealed) {
    if (sealed.policyId !== args.policyId) {
      throw new Error('sessionSeal policyId mismatch')
    }
    sessions.set(sealed.policyId, sealed)
    return sealed
  }
  const session = sessions.get(args.policyId)
  if (!session) {
    throw new Error(
      `Unknown policyId "${args.policyId}" on site gate — click Go live again (session expired or cold start)`
    )
  }
  return session
}

export function siteGateApply(args: {
  policyId: string
  ownerId: string
  ownerToken?: string
  policy: MandatePolicy
  sessionSeal?: string
}): {
  ok: true
  policyId: string
  ownerId: string
  ownerToken: string
  mode: 'site-gate'
  policy: MandatePolicy
  sessionSeal: string
} {
  prune()
  const policy = MandatePolicySchema.parse({
    ...args.policy,
    ownerId: args.ownerId,
  })
  const sealed = decodeSessionSeal(args.sessionSeal)
  const existing =
    (sealed && sealed.policyId === args.policyId ? sealed : null) ||
    sessions.get(args.policyId)

  let ownerToken = args.ownerToken?.trim()
  if (existing) {
    if (existing.ownerId !== args.ownerId) {
      throw new Error('ownerId does not match this policyId session')
    }
    if (ownerToken && ownerToken !== existing.ownerToken) {
      throw new Error('ownerToken mismatch')
    }
    ownerToken = existing.ownerToken
  } else {
    ownerToken = ownerToken || randomUUID().replace(/-/g, '')
  }

  const session: Session = {
    policyId: args.policyId,
    ownerId: args.ownerId,
    ownerToken,
    policy,
    ledger: existing?.ledger ?? freshLedger(),
    updatedAt: Date.now(),
  }
  sessions.set(args.policyId, session)

  return {
    ok: true,
    policyId: args.policyId,
    ownerId: args.ownerId,
    ownerToken,
    mode: 'site-gate',
    policy,
    sessionSeal: encodeSessionSeal(session),
  }
}

export function siteGateEvaluate(args: {
  policyId: string
  intent: SpendIntent
  sessionSeal?: string
}): {
  ok: true
  mode: 'site-gate'
  decision: 'allow' | 'deny' | 'escalate'
  result: ReturnType<typeof evaluateIntent> & { receipt?: ReturnType<typeof issueAllowReceipt> }
  receipt: ReturnType<typeof issueAllowReceipt> | null
  sessionSeal: string
} {
  const session = resolveSession({
    policyId: args.policyId,
    sessionSeal: args.sessionSeal,
  })

  const evaluation = evaluateIntent(session.policy, args.intent, session.ledger)
  let receipt: ReturnType<typeof issueAllowReceipt> | null = null

  if (evaluation.decision === 'allow') {
    receipt = issueAllowReceipt({
      policy: session.policy,
      policyId: session.policyId,
      intent: args.intent,
      evaluation,
    })
    session.ledger = commitIntent(session.ledger, args.intent)
  }
  session.updatedAt = Date.now()
  sessions.set(session.policyId, session)

  return {
    ok: true,
    mode: 'site-gate',
    decision: evaluation.decision,
    result: { ...evaluation, receipt: receipt ?? undefined },
    receipt,
    sessionSeal: encodeSessionSeal(session),
  }
}

export function siteGateConfigured(): boolean {
  return Boolean(sealSecret())
}
