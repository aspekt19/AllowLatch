/**
 * Durable site-gate backend (Turso / libsql) for Vercel multi-instance safety.
 * Env: ALLOWLATCH_TURSO_DATABASE_URL (+ ALLOWLATCH_TURSO_AUTH_TOKEN) or TURSO_*.
 * When unset, site-gate stays on memory + sessionSeal (demo-grade).
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  MandatePolicySchema,
  type MandatePolicy,
  type SpendIntent,
  type SpendLedger,
} from '../policy/schema.js'
import { commitIntent, evaluateIntent, freshLedger } from '../policy/engine.js'
import {
  issueAllowReceipt,
  parseAllowReceipt,
  verifyAllowReceipt,
  type AllowReceipt,
} from '../billing/receipt.js'
import {
  tursoAuthToken,
  tursoConfigured,
  tursoDatabaseUrl,
} from './site-gate-durable-config.js'

export { tursoConfigured } from './site-gate-durable-config.js'

export type DurableRow = {
  policyId: string
  ownerId: string
  ownerTokenHash: string
  policy: MandatePolicy
  ledger: SpendLedger
  seq: number
  updatedAt: number
}

type LibsqlClient = {
  execute: (arg: { sql: string; args?: unknown[] }) => Promise<{
    rows: Record<string, unknown>[]
    rowsAffected: number
  }>
  executeMultiple: (sql: string) => Promise<unknown>
}

let client: LibsqlClient | null = null
let ready: Promise<void> | null = null

export function hashOwnerToken(token: string): string {
  return createHash('sha256').update(`al-owner:${token}`).digest('hex')
}

async function getClient(): Promise<LibsqlClient> {
  if (!client) {
    const { createClient } = await import('@libsql/client')
    client = createClient({
      url: tursoDatabaseUrl(),
      authToken: tursoAuthToken(),
    }) as unknown as LibsqlClient
  }
  if (!ready) {
    ready = (async () => {
      await client!.executeMultiple(`
        CREATE TABLE IF NOT EXISTS site_policies (
          policy_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          owner_token_hash TEXT NOT NULL,
          policy_json TEXT NOT NULL,
          ledger_json TEXT NOT NULL,
          seq INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS site_receipts (
          jti TEXT PRIMARY KEY,
          policy_id TEXT NOT NULL,
          intent_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          receipt_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          settled_at INTEGER
        );
      `)
    })()
  }
  await ready
  return client
}

async function loadRow(policyId: string): Promise<DurableRow | null> {
  const c = await getClient()
  const rs = await c.execute({
    sql: 'SELECT * FROM site_policies WHERE policy_id = ?',
    args: [policyId],
  })
  const row = rs.rows[0]
  if (!row) return null
  return {
    policyId: String(row.policy_id),
    ownerId: String(row.owner_id),
    ownerTokenHash: String(row.owner_token_hash),
    policy: MandatePolicySchema.parse(JSON.parse(String(row.policy_json))),
    ledger: JSON.parse(String(row.ledger_json)) as SpendLedger,
    seq: Number(row.seq),
    updatedAt: Number(row.updated_at),
  }
}

async function upsertRow(row: DurableRow): Promise<void> {
  const c = await getClient()
  await c.execute({
    sql: `INSERT INTO site_policies (policy_id, owner_id, owner_token_hash, policy_json, ledger_json, seq, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(policy_id) DO UPDATE SET
            owner_id=excluded.owner_id,
            owner_token_hash=excluded.owner_token_hash,
            policy_json=excluded.policy_json,
            ledger_json=excluded.ledger_json,
            seq=excluded.seq,
            updated_at=excluded.updated_at`,
    args: [
      row.policyId,
      row.ownerId,
      row.ownerTokenHash,
      JSON.stringify(row.policy),
      JSON.stringify(row.ledger),
      row.seq,
      row.updatedAt,
    ],
  })
}

export async function durableApply(args: {
  policyId: string
  ownerId: string
  ownerToken?: string
  policy: MandatePolicy
}): Promise<{
  policyId: string
  ownerId: string
  ownerToken: string
  policy: MandatePolicy
  ledger: SpendLedger
  seq: number
  durable: true
}> {
  const existing = await loadRow(args.policyId)
  let ownerToken = args.ownerToken?.trim()
  if (existing) {
    if (existing.ownerId !== args.ownerId) {
      throw new Error('ownerId does not match this policyId')
    }
    if (ownerToken && hashOwnerToken(ownerToken) !== existing.ownerTokenHash) {
      throw new Error('ownerToken mismatch')
    }
    // Token only known to client — we store hash. Reuse provided token or mint new on first apply.
    if (!ownerToken) {
      throw new Error('ownerToken required to update durable site policy (server stores hash only)')
    }
  } else {
    ownerToken = ownerToken || randomUUID().replace(/-/g, '')
  }

  const policy = MandatePolicySchema.parse({ ...args.policy, ownerId: args.ownerId })
  const row: DurableRow = {
    policyId: args.policyId,
    ownerId: args.ownerId,
    ownerTokenHash: hashOwnerToken(ownerToken!),
    policy,
    ledger: existing?.ledger ?? freshLedger(),
    seq: (existing?.seq ?? -1) + 1,
    updatedAt: Date.now(),
  }
  await upsertRow(row)
  return {
    policyId: row.policyId,
    ownerId: row.ownerId,
    ownerToken: ownerToken!,
    policy: row.policy,
    ledger: row.ledger,
    seq: row.seq,
    durable: true as const,
  }
}

export async function durableEvaluate(args: {
  policyId: string
  intent: SpendIntent
}): Promise<{
  decision: 'allow' | 'deny' | 'escalate'
  result: ReturnType<typeof evaluateIntent> & { receipt?: AllowReceipt }
  receipt: AllowReceipt | null
  seq: number
  durable: true
}> {
  const c = await getClient()
  // Serialize per policy via read-modify-write; Turso serializes writes on the primary.
  const existing = await loadRow(args.policyId)
  if (!existing) {
    throw new Error(
      `Unknown policyId "${args.policyId}" on durable site gate — Go live again or apply first`
    )
  }

  const evaluation = evaluateIntent(existing.policy, args.intent, existing.ledger)
  let receipt: AllowReceipt | null = null
  let ledger = existing.ledger
  let seq = existing.seq

  if (evaluation.decision === 'allow') {
    receipt = issueAllowReceipt({
      policy: existing.policy,
      policyId: existing.policyId,
      intent: args.intent,
      evaluation,
    })
    if (!receipt) {
      throw new Error('failed to issue allow-receipt')
    }
    ledger = commitIntent(existing.ledger, args.intent)
    seq = existing.seq + 1

    // Insert jti first — unique PK makes double-issue from races fail closed.
    try {
      await c.execute({
        sql: `INSERT INTO site_receipts (jti, policy_id, intent_hash, status, receipt_json, created_at)
              VALUES (?, ?, ?, 'authorized', ?, ?)`,
        args: [
          receipt.jti,
          args.policyId,
          receipt.intentHash,
          JSON.stringify(receipt),
          Date.now(),
        ],
      })
    } catch (err) {
      throw new Error(
        `receipt jti conflict (fail-closed): ${err instanceof Error ? err.message : String(err)}`
      )
    }

    await upsertRow({
      ...existing,
      ledger,
      seq,
      updatedAt: Date.now(),
    })
  }

  return {
    decision: evaluation.decision,
    result: { ...evaluation, receipt: receipt ?? undefined },
    receipt,
    seq,
    durable: true,
  }
}

/**
 * Mark an allow-receipt settled (single-use). Budget was already reserved at authorize.
 * Call after the agent successfully uses the receipt to sign — or immediately before sign.
 */
export async function durableConsume(args: {
  policyId: string
  receipt: unknown
  intent?: SpendIntent
}): Promise<{ ok: true; jti: string; durable: true }> {
  const receipt = parseAllowReceipt(args.receipt)
  if (!receipt) throw new Error('invalid receipt')
  if (receipt.policyId !== args.policyId) throw new Error('receipt policyId mismatch')

  const existing = await loadRow(args.policyId)
  if (!existing) throw new Error('unknown policyId')

  const verified = verifyAllowReceipt(receipt, {
    policy: existing.policy,
    intent: args.intent,
  })
  if (!verified.ok) throw new Error(verified.error)

  const c = await getClient()
  const rs = await c.execute({
    sql: 'SELECT status FROM site_receipts WHERE jti = ?',
    args: [receipt.jti],
  })
  const row = rs.rows[0]
  if (!row) throw new Error('unknown receipt jti')
  if (String(row.status) === 'settled') throw new Error('receipt jti already settled')

  const upd = await c.execute({
    sql: `UPDATE site_receipts SET status = 'settled', settled_at = ?
           WHERE jti = ? AND status = 'authorized'`,
    args: [Date.now(), receipt.jti],
  })
  if (upd.rowsAffected !== 1) {
    throw new Error('receipt jti already settled or missing')
  }
  return { ok: true, jti: receipt.jti, durable: true }
}

export async function durableHasPolicy(policyId: string): Promise<boolean> {
  return Boolean(await loadRow(policyId))
}
