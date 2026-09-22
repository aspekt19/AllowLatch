/**
 * Website product gate — deterministic engine + allow-receipt on Vercel.
 *
 * Backends:
 * - Durable (Turso): shared ledger + atomic jti — set ALLOWLATCH_TURSO_DATABASE_URL
 * - Memory + sessionSeal: demo / cold-start without Turso (not multi-instance safe)
 *
 * See docs/SECURITY.md.
 */
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  MandatePolicySchema,
  SpendLedgerSchema,
  type MandatePolicy,
  type SpendIntent,
  type SpendLedger,
} from '../policy/schema.js'
import { commitIntent, evaluateIntent, freshLedger } from '../policy/engine.js'
import { issueAllowReceipt, type AllowReceipt } from '../billing/receipt.js'
import {
  durableApply,
  durableConsume,
  durableEvaluate,
  tursoConfigured,
} from './site-gate-durable.js'

type Session = {
  policyId: string
  ownerId: string
  ownerToken: string
  policy: MandatePolicy
  ledger: SpendLedger
  seq: number
  updatedAt: number
}

const TTL_MS = 1000 * 60 * 60 * 12 // 12h
const sessions = new Map<string, Session>()
let warnedServFallback = false

function sealSecret(): string {
  const dedicated = process.env.ALLOWLATCH_RECEIPT_SECRET?.trim()
  if (dedicated) return dedicated
  const serv = process.env.SERV_API_KEY?.trim()
  if (serv) {
    if (!warnedServFallback) {
      warnedServFallback = true
      console.warn(
        '[site-gate] ALLOWLATCH_RECEIPT_SECRET unset — falling back to SERV_API_KEY. ' +
          'Set a dedicated receipt secret in production (do not reuse Reasoning keys).'
      )
    }
    return serv
  }
  return ''
}

function hashOwnerToken(token: string): string {
  return createHash('sha256').update(`al-owner:${token}`).digest('hex')
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

/** v2 = memory seal with ledger; v3 = durable reference (no ledger in client). */
export function encodeSessionSeal(
  session: Session,
  opts?: { durable?: boolean }
): string {
  const body = opts?.durable
    ? {
        v: 3 as const,
        durable: true as const,
        policyId: session.policyId,
        ownerId: session.ownerId,
        ownerTokenHash: hashOwnerToken(session.ownerToken),
        seq: session.seq,
        updatedAt: session.updatedAt,
      }
    : {
        v: 2 as const,
        policyId: session.policyId,
        ownerId: session.ownerId,
        ownerTokenHash: hashOwnerToken(session.ownerToken),
        policy: session.policy,
        ledger: session.ledger,
        seq: session.seq,
        updatedAt: session.updatedAt,
      }
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')
  const sig = signSealPayload(payload)
  return `${payload}.${sig}`
}

type DecodedSeal = {
  policyId: string
  ownerId: string
  ownerTokenHash: string
  legacyOwnerToken?: string
  policy?: MandatePolicy
  ledger?: SpendLedger
  seq: number
  updatedAt: number
  durable?: boolean
}

export function decodeSessionSeal(seal: string | undefined): DecodedSeal | null {
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
      durable?: boolean
      policyId?: string
      ownerId?: string
      ownerToken?: string
      ownerTokenHash?: string
      policy?: unknown
      ledger?: unknown
      seq?: number
      updatedAt?: number
    }
    if (!raw.policyId || !raw.ownerId) return null
    if (typeof raw.updatedAt !== 'number' || Date.now() - raw.updatedAt > TTL_MS) return null
    const seq = typeof raw.seq === 'number' && raw.seq >= 0 ? raw.seq : 0

    if (raw.v === 3) {
      if (!raw.ownerTokenHash || raw.ownerTokenHash.length < 32) return null
      return {
        policyId: raw.policyId,
        ownerId: raw.ownerId,
        ownerTokenHash: raw.ownerTokenHash,
        seq,
        updatedAt: raw.updatedAt,
        durable: true,
      }
    }

    if (raw.v === 2) {
      if (!raw.ownerTokenHash || raw.ownerTokenHash.length < 32) return null
      return {
        policyId: raw.policyId,
        ownerId: raw.ownerId,
        ownerTokenHash: raw.ownerTokenHash,
        policy: MandatePolicySchema.parse(raw.policy),
        ledger: SpendLedgerSchema.parse(raw.ledger ?? freshLedger()),
        seq,
        updatedAt: raw.updatedAt,
      }
    }

    if (raw.v === 1 && raw.ownerToken) {
      return {
        policyId: raw.policyId,
        ownerId: raw.ownerId,
        ownerTokenHash: hashOwnerToken(raw.ownerToken),
        legacyOwnerToken: raw.ownerToken,
        policy: MandatePolicySchema.parse(raw.policy),
        ledger: SpendLedgerSchema.parse(raw.ledger ?? freshLedger()),
        seq,
        updatedAt: raw.updatedAt,
      }
    }
    return null
  } catch {
    return null
  }
}

function materializeFromSeal(sealed: DecodedSeal, existing?: Session): Session {
  if (!sealed.policy || !sealed.ledger) {
    throw new Error('sessionSeal missing policy/ledger — durable gate must be configured')
  }
  const ownerToken =
    sealed.legacyOwnerToken || existing?.ownerToken || `seal-only:${sealed.policyId}`

  return {
    policyId: sealed.policyId,
    ownerId: sealed.ownerId,
    ownerToken:
      existing && hashOwnerToken(existing.ownerToken) === sealed.ownerTokenHash
        ? existing.ownerToken
        : sealed.legacyOwnerToken || existing?.ownerToken || ownerToken,
    policy: sealed.policy,
    ledger: sealed.ledger,
    seq: sealed.seq,
    updatedAt: sealed.updatedAt,
  }
}

function resolveSession(args: { policyId: string; sessionSeal?: string }): Session {
  prune()
  const sealed = decodeSessionSeal(args.sessionSeal)
  const current = sessions.get(args.policyId)

  if (sealed) {
    if (sealed.policyId !== args.policyId) {
      throw new Error('sessionSeal policyId mismatch')
    }
    if (sealed.durable) {
      throw new Error('durable sessionSeal requires Turso-backed site gate')
    }
    if (current && current.seq > sealed.seq) {
      throw new Error(
        'stale sessionSeal (ledger moved forward) — use the latest seal from the previous evaluate response'
      )
    }
    if (current && current.seq === sealed.seq && current.updatedAt >= sealed.updatedAt) {
      return current
    }
    const session = materializeFromSeal(sealed, current)
    sessions.set(session.policyId, session)
    return session
  }

  if (!current) {
    throw new Error(
      `Unknown policyId "${args.policyId}" on site gate — click Go live again (session expired or cold start)`
    )
  }
  return current
}

export function siteGateDurable(): boolean {
  return tursoConfigured()
}

export async function siteGateApply(args: {
  policyId: string
  ownerId: string
  ownerToken?: string
  policy: MandatePolicy
  sessionSeal?: string
}): Promise<{
  ok: true
  policyId: string
  ownerId: string
  ownerToken: string
  mode: 'site-gate'
  policy: MandatePolicy
  sessionSeal: string
  durable: boolean
}> {
  const policy = MandatePolicySchema.parse({
    ...args.policy,
    ownerId: args.ownerId,
  })

  if (tursoConfigured()) {
    const applied = await durableApply({
      policyId: args.policyId,
      ownerId: args.ownerId,
      ownerToken: args.ownerToken,
      policy,
    })
    const session: Session = {
      policyId: applied.policyId,
      ownerId: applied.ownerId,
      ownerToken: applied.ownerToken,
      policy: applied.policy,
      ledger: applied.ledger,
      seq: applied.seq,
      updatedAt: Date.now(),
    }
    sessions.set(session.policyId, session)
    return {
      ok: true,
      policyId: applied.policyId,
      ownerId: applied.ownerId,
      ownerToken: applied.ownerToken,
      mode: 'site-gate',
      policy: applied.policy,
      sessionSeal: encodeSessionSeal(session, { durable: true }),
      durable: true,
    }
  }

  prune()
  const sealed = decodeSessionSeal(args.sessionSeal)
  const existing =
    (sealed && sealed.policyId === args.policyId && !sealed.durable
      ? materializeFromSeal(sealed, sessions.get(args.policyId))
      : null) || sessions.get(args.policyId)

  let ownerToken = args.ownerToken?.trim()
  if (existing) {
    if (existing.ownerId !== args.ownerId) {
      throw new Error('ownerId does not match this policyId session')
    }
    if (ownerToken) {
      const matchesExisting = ownerToken === existing.ownerToken
      const matchesSeal =
        (sealed?.ownerTokenHash != null &&
          hashOwnerToken(ownerToken) === sealed.ownerTokenHash) ||
        (sealed?.legacyOwnerToken != null && ownerToken === sealed.legacyOwnerToken)
      if (!matchesExisting && !matchesSeal && !existing.ownerToken.startsWith('seal-only:')) {
        throw new Error('ownerToken mismatch')
      }
      if (!existing.ownerToken.startsWith('seal-only:')) {
        ownerToken = existing.ownerToken
      }
    } else if (existing.ownerToken.startsWith('seal-only:')) {
      ownerToken = randomUUID().replace(/-/g, '')
    } else {
      ownerToken = existing.ownerToken
    }
  } else {
    ownerToken = ownerToken || randomUUID().replace(/-/g, '')
  }

  const prevSeq = existing?.seq ?? -1
  const session: Session = {
    policyId: args.policyId,
    ownerId: args.ownerId,
    ownerToken,
    policy,
    ledger: existing?.ledger ?? freshLedger(),
    seq: prevSeq + 1,
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
    durable: false,
  }
}

export async function siteGateEvaluate(args: {
  policyId: string
  intent: SpendIntent
  sessionSeal?: string
}): Promise<{
  ok: true
  mode: 'site-gate'
  decision: 'allow' | 'deny' | 'escalate'
  result: ReturnType<typeof evaluateIntent> & { receipt?: AllowReceipt }
  receipt: AllowReceipt | null
  sessionSeal: string
  durable: boolean
}> {
  if (tursoConfigured()) {
    const evaluated = await durableEvaluate({
      policyId: args.policyId,
      intent: args.intent,
    })
    const known = sessions.get(args.policyId)
    const sealed = decodeSessionSeal(args.sessionSeal)
    const placeholderPolicy = MandatePolicySchema.parse({
      version: '1.0',
      name: 'durable',
      chain: 'base',
      currency: 'USDC',
      capital: {
        agentWalletBudgetUsd: 0,
        maxNotionalUsdPerDay: 1,
        maxPerOrderUsd: 1,
        maxTransactionsPerHour: 1,
      },
      universe: {
        allowedSymbols: [],
        deniedSymbols: [],
        allowedAddresses: [],
        deniedAddresses: [],
        allowedContracts: [],
        deniedContracts: [],
        allowedTokenAddresses: [],
        deniedTokenAddresses: [],
        allowedFunctionSelectors: [],
        deniedFunctionSelectors: [],
      },
      actions: { allowSwap: false, allowTransfer: true, allowX402Pay: false },
      risk: { emergencyStop: false },
      escalation: { requireHumanConfirmAboveUsd: 0 },
    })
    const sealSession: Session = known
      ? { ...known, seq: evaluated.seq, updatedAt: Date.now() }
      : {
          policyId: args.policyId,
          ownerId: sealed?.ownerId || 'durable',
          ownerToken: `durable:${args.policyId}`,
          policy: placeholderPolicy,
          ledger: freshLedger(),
          seq: evaluated.seq,
          updatedAt: Date.now(),
        }
    if (known) sessions.set(args.policyId, sealSession)
    return {
      ok: true,
      mode: 'site-gate',
      decision: evaluated.decision,
      result: evaluated.result,
      receipt: evaluated.receipt,
      sessionSeal: encodeSessionSeal(sealSession, { durable: true }),
      durable: true,
    }
  }

  const session = resolveSession({
    policyId: args.policyId,
    sessionSeal: args.sessionSeal,
  })

  const evaluation = evaluateIntent(session.policy, args.intent, session.ledger)
  let receipt: AllowReceipt | null = null

  if (evaluation.decision === 'allow') {
    receipt = issueAllowReceipt({
      policy: session.policy,
      policyId: session.policyId,
      intent: args.intent,
      evaluation,
    })
    session.ledger = commitIntent(session.ledger, args.intent)
    session.seq += 1
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
    durable: false,
  }
}

export async function siteGateConsume(args: {
  policyId: string
  receipt: unknown
  intent?: SpendIntent
}): Promise<{ ok: true; jti: string; durable: boolean }> {
  if (!tursoConfigured()) {
    throw new Error(
      'siteGateConsume requires durable Turso backend (ALLOWLATCH_TURSO_DATABASE_URL)'
    )
  }
  const out = await durableConsume(args)
  return { ok: true, jti: out.jti, durable: true }
}

export {
  durableAddPackCredits as siteGateBuyPack,
  durableTryConsumePackCredit as siteGateTryConsumePack,
  durableGetPackCredits as siteGatePackCredits,
} from './site-gate-durable.js'

export function siteGateConfigured(): boolean {
  return Boolean(sealSecret())
}

export { tursoConfigured } from './site-gate-durable-config.js'
