/**
 * Website product gate — deterministic engine + allow-receipt on Vercel.
 * Does not depend on OpenServ container uptime (that path stays for external agents).
 */
import { randomUUID } from 'node:crypto'
import {
  MandatePolicySchema,
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

function prune() {
  const now = Date.now()
  for (const [k, s] of sessions) {
    if (now - s.updatedAt > TTL_MS) sessions.delete(k)
  }
}

export function siteGateApply(args: {
  policyId: string
  ownerId: string
  ownerToken?: string
  policy: MandatePolicy
}): {
  ok: true
  policyId: string
  ownerId: string
  ownerToken: string
  mode: 'site-gate'
  policy: MandatePolicy
} {
  prune()
  const policy = MandatePolicySchema.parse({
    ...args.policy,
    ownerId: args.ownerId,
  })
  const existing = sessions.get(args.policyId)
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

  sessions.set(args.policyId, {
    policyId: args.policyId,
    ownerId: args.ownerId,
    ownerToken,
    policy,
    ledger: existing?.ledger ?? freshLedger(),
    updatedAt: Date.now(),
  })

  return {
    ok: true,
    policyId: args.policyId,
    ownerId: args.ownerId,
    ownerToken,
    mode: 'site-gate',
    policy,
  }
}

export function siteGateEvaluate(args: {
  policyId: string
  intent: SpendIntent
}): {
  ok: true
  mode: 'site-gate'
  decision: 'allow' | 'deny' | 'escalate'
  result: ReturnType<typeof evaluateIntent> & { receipt?: ReturnType<typeof issueAllowReceipt> }
  receipt: ReturnType<typeof issueAllowReceipt> | null
} {
  prune()
  const session = sessions.get(args.policyId)
  if (!session) {
    throw new Error(
      `Unknown policyId "${args.policyId}" on site gate — click Go live again (session expired or cold start)`
    )
  }

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
    session.updatedAt = Date.now()
    sessions.set(args.policyId, session)
  }

  return {
    ok: true,
    mode: 'site-gate',
    decision: evaluation.decision,
    result: { ...evaluation, receipt: receipt ?? undefined },
    receipt,
  }
}

export function siteGateConfigured(): boolean {
  return Boolean(
    process.env.ALLOWLATCH_RECEIPT_SECRET?.trim() || process.env.SERV_API_KEY?.trim()
  )
}
