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
import { commitIntent, evaluateIntent, freshLedger, releaseIntent } from '../policy/engine.js'
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

type SqlResult = {
  rows: Record<string, unknown>[]
  rowsAffected: number
}

type SqlExec = {
  execute: (arg: { sql: string; args?: unknown[] }) => Promise<SqlResult>
}

type Tx = SqlExec & {
  commit: () => Promise<void>
  rollback: () => Promise<void>
  close: () => void
}

type LibsqlClient = SqlExec & {
  executeMultiple: (sql: string) => Promise<unknown>
  transaction: (mode?: 'write' | 'read' | 'deferred') => Promise<Tx>
  close: () => void
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
          settled_at INTEGER,
          amount_usd REAL,
          expires_at INTEGER,
          gas_usd REAL
        );
        CREATE TABLE IF NOT EXISTS site_rate (
          bucket TEXT PRIMARY KEY,
          n INTEGER NOT NULL,
          reset_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS site_packs (
          pack_key TEXT PRIMARY KEY,
          credits INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS site_wallet_bindings (
          policy_id TEXT PRIMARY KEY,
          json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
      try {
        await client!.execute({ sql: 'PRAGMA busy_timeout = 5000', args: [] })
        await client!.execute({ sql: 'PRAGMA journal_mode = WAL', args: [] })
      } catch {
        /* remote Turso ignores local pragmas */
      }
      for (const sql of [
        'ALTER TABLE site_receipts ADD COLUMN amount_usd REAL',
        'ALTER TABLE site_receipts ADD COLUMN expires_at INTEGER',
        'ALTER TABLE site_receipts ADD COLUMN gas_usd REAL',
      ]) {
        try {
          await client!.execute({ sql, args: [] })
        } catch {
          /* column already exists */
        }
      }
    })()
  }
  await ready
  return client
}

/**
 * Release budget for authorized receipts past expiresAt (unused ALLOW → avoid ledger DoS).
 * Marks status=released. Safe to call before evaluate.
 */
export async function durableReleaseExpired(policyId?: string): Promise<number> {
  const c = await getClient()
  const nowSec = Math.floor(Date.now() / 1000)
  const rs = await c.execute({
    sql: policyId
      ? `SELECT jti, policy_id, amount_usd, gas_usd, created_at, receipt_json
         FROM site_receipts
         WHERE status = 'authorized' AND policy_id = ? AND expires_at IS NOT NULL AND expires_at < ?`
      : `SELECT jti, policy_id, amount_usd, gas_usd, created_at, receipt_json
         FROM site_receipts
         WHERE status = 'authorized' AND expires_at IS NOT NULL AND expires_at < ?`,
    args: policyId ? [policyId, nowSec] : [nowSec],
  })
  let released = 0
  for (const row of rs.rows) {
    const jti = String(row.jti)
    const pid = String(row.policy_id)
    const amountUsd = Number(row.amount_usd)
    const gasUsd = Number(row.gas_usd ?? 0)
    // Legacy rows without amount_usd: mark released without ledger undo (cannot safely reverse).
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      await c.execute({
        sql: `UPDATE site_receipts SET status = 'released', settled_at = ?
              WHERE jti = ? AND status = 'authorized'`,
        args: [Date.now(), jti],
      })
      released += 1
      continue
    }
    try {
      await withWriteTx(async (tx) => {
        const existing = await loadRowOn(tx, pid)
        if (!existing) return
        const reservedAt = new Date(Number(row.created_at) || Date.now())
        const ledger = releaseIntent(
          existing.ledger,
          { amountUsd, estimatedGasUsd: Number.isFinite(gasUsd) ? gasUsd : 0 },
          reservedAt
        )
        const seq = existing.seq + 1
        const upd = await tx.execute({
          sql: `UPDATE site_policies SET ledger_json=?, seq=?, updated_at=?
                WHERE policy_id=? AND seq=?`,
          args: [JSON.stringify(ledger), seq, Date.now(), pid, existing.seq],
        })
        if (Number(upd.rowsAffected) !== 1) return RETRY
        const mark = await tx.execute({
          sql: `UPDATE site_receipts SET status = 'released', settled_at = ?
                WHERE jti = ? AND status = 'authorized'`,
          args: [Date.now(), jti],
        })
        if (Number(mark.rowsAffected) !== 1) return RETRY
      })
      released += 1
    } catch {
      /* concurrent settle/release — skip */
    }
  }
  return released
}

/** Test hook — drop the cached client so a file: URL can be swapped. */
export function resetDurableClientForTests(): void {
  try {
    client?.close()
  } catch {
    /* ignore */
  }
  client = null
  ready = null
}

async function endTx(tx: Tx, action: 'commit' | 'rollback'): Promise<void> {
  try {
    if (action === 'commit') await tx.commit()
    else {
      try {
        await tx.rollback()
      } catch {
        /* transaction already aborted */
      }
    }
  } finally {
    try {
      tx.close()
    } catch {
      /* already closed */
    }
  }
}

function isUniqueConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /UNIQUE|SQLITE_CONSTRAINT|constraint failed/i.test(message)
}

function isBusy(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /SQLITE_BUSY|database is locked|statements in progress/i.test(message)
}

const RETRY = Symbol('retry')

async function withWriteTx<T>(
  fn: (tx: Tx) => Promise<T | typeof RETRY>,
  opts?: { retryUnique?: boolean }
): Promise<T> {
  const c = await getClient()
  let last: unknown = new Error('concurrent write (fail-closed)')
  for (let attempt = 0; attempt < 8; attempt++) {
    let tx: Tx
    try {
      tx = await c.transaction('write')
    } catch (err) {
      last = err
      if (isBusy(err)) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
        continue
      }
      throw err
    }
    try {
      const result = await fn(tx)
      if (result === RETRY) {
        await endTx(tx, 'rollback')
        continue
      }
      await endTx(tx, 'commit')
      return result as T
    } catch (err) {
      await endTx(tx, 'rollback')
      last = err
      if (isBusy(err) || (opts?.retryUnique && isUniqueConflict(err))) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

async function loadRowOn(db: SqlExec, policyId: string): Promise<DurableRow | null> {
  const rs = await db.execute({
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

async function loadRow(policyId: string): Promise<DurableRow | null> {
  return loadRowOn(await getClient(), policyId)
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
  const policy = MandatePolicySchema.parse({ ...args.policy, ownerId: args.ownerId })
  let ownerToken = args.ownerToken?.trim() || ''

  return withWriteTx(async (tx) => {
    const existing = await loadRowOn(tx, args.policyId)
    if (existing) {
      if (existing.ownerId !== args.ownerId) {
        throw new Error('ownerId does not match this policyId')
      }
      if (!ownerToken) {
        throw new Error(
          'ownerToken required to update durable site policy (server stores hash only)'
        )
      }
      if (hashOwnerToken(ownerToken) !== existing.ownerTokenHash) {
        throw new Error('ownerToken mismatch')
      }
      const now = Date.now()
      const upd = await tx.execute({
        sql: `UPDATE site_policies
              SET owner_id=?, owner_token_hash=?, policy_json=?, seq=seq+1, updated_at=?
              WHERE policy_id=? AND seq=? AND owner_token_hash=?`,
        args: [
          args.ownerId,
          existing.ownerTokenHash,
          JSON.stringify(policy),
          now,
          args.policyId,
          existing.seq,
          existing.ownerTokenHash,
        ],
      })
      if (Number(upd.rowsAffected) !== 1) return RETRY
      return {
        policyId: args.policyId,
        ownerId: args.ownerId,
        ownerToken,
        policy,
        ledger: existing.ledger,
        seq: existing.seq + 1,
        durable: true as const,
      }
    }

    const minted = ownerToken || randomUUID().replace(/-/g, '')
    const now = Date.now()
    const ledger = freshLedger()
    await tx.execute({
      sql: `INSERT INTO site_policies
            (policy_id, owner_id, owner_token_hash, policy_json, ledger_json, seq, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)`,
      args: [
        args.policyId,
        args.ownerId,
        hashOwnerToken(minted),
        JSON.stringify(policy),
        JSON.stringify(ledger),
        now,
      ],
    })
    ownerToken = minted
    return {
      policyId: args.policyId,
      ownerId: args.ownerId,
      ownerToken,
      policy,
      ledger,
      seq: 0,
      durable: true as const,
    }
  }, { retryUnique: true })
}

export async function durableEvaluate(args: {
  policyId: string
  intent: SpendIntent
  /** Owner confirmed escalate — mints receipt + reserves budget (spender cannot self-approve). */
  humanApproved?: boolean
  ownerToken?: string
}): Promise<{
  decision: 'allow' | 'deny' | 'escalate'
  result: ReturnType<typeof evaluateIntent> & { receipt?: AllowReceipt }
  receipt: AllowReceipt | null
  seq: number
  durable: true
}> {
  return withWriteTx(async (tx) => {
    const existing = await loadRowOn(tx, args.policyId)
    if (!existing) {
      throw new Error(
        `Unknown policyId "${args.policyId}" on durable site gate — Go live again or apply first`
      )
    }

    // Release expired authorized receipts inside this tx so client seal seq stays valid at entry.
    let ledger = existing.ledger
    let releasedBudget = false
    const nowSec = Math.floor(Date.now() / 1000)
    const expired = await tx.execute({
      sql: `SELECT jti, amount_usd, gas_usd, created_at FROM site_receipts
            WHERE policy_id = ? AND status = 'authorized'
              AND expires_at IS NOT NULL AND expires_at < ?`,
      args: [args.policyId, nowSec],
    })
    for (const row of expired.rows) {
      const amountUsd = Number(row.amount_usd)
      if (Number.isFinite(amountUsd) && amountUsd > 0) {
        ledger = releaseIntent(
          ledger,
          {
            amountUsd,
            estimatedGasUsd: Number(row.gas_usd ?? 0) || 0,
          },
          new Date(Number(row.created_at) || Date.now())
        )
        releasedBudget = true
      }
      await tx.execute({
        sql: `UPDATE site_receipts SET status = 'released', settled_at = ?
              WHERE jti = ? AND status = 'authorized'`,
        args: [Date.now(), String(row.jti)],
      })
    }
    let seq = existing.seq + (releasedBudget ? 1 : 0)

    let evaluation = evaluateIntent(existing.policy, args.intent, ledger)
    if (evaluation.decision === 'escalate' && args.humanApproved) {
      const token = args.ownerToken?.trim()
      if (!token || hashOwnerToken(token) !== existing.ownerTokenHash) {
        throw new Error(
          'humanApproved requires matching ownerToken (spender cannot self-approve escalation)'
        )
      }
      evaluation = {
        ...evaluation,
        decision: 'allow',
        reasons: [
          ...evaluation.reasons,
          'Human approved escalation; treating as ALLOW for this authorization.',
        ],
      }
    }

    if (evaluation.decision !== 'allow') {
      if (seq !== existing.seq) {
        const now = Date.now()
        const upd = await tx.execute({
          sql: `UPDATE site_policies SET ledger_json=?, seq=?, updated_at=?
                WHERE policy_id=? AND seq=?`,
          args: [JSON.stringify(ledger), seq, now, args.policyId, existing.seq],
        })
        if (Number(upd.rowsAffected) !== 1) return RETRY
      }
      return {
        decision: evaluation.decision,
        result: evaluation,
        receipt: null,
        seq,
        durable: true as const,
      }
    }

    ledger = commitIntent(ledger, args.intent)
    seq += 1
    const now = Date.now()
    const upd = await tx.execute({
      sql: `UPDATE site_policies SET ledger_json=?, seq=?, updated_at=?
            WHERE policy_id=? AND seq=?`,
      args: [JSON.stringify(ledger), seq, now, args.policyId, existing.seq],
    })
    if (Number(upd.rowsAffected) !== 1) return RETRY

    const receipt = issueAllowReceipt({
      policy: existing.policy,
      policyId: existing.policyId,
      intent: args.intent,
      evaluation,
    })
    if (!receipt) throw new Error('failed to issue allow-receipt')

    await tx.execute({
      sql: `INSERT INTO site_receipts
            (jti, policy_id, intent_hash, status, receipt_json, created_at, amount_usd, expires_at, gas_usd)
            VALUES (?, ?, ?, 'authorized', ?, ?, ?, ?, ?)`,
      args: [
        receipt.jti,
        args.policyId,
        receipt.intentHash,
        JSON.stringify(receipt),
        now,
        args.intent.amountUsd,
        receipt.expiresAt,
        args.intent.estimatedGasUsd ?? 0,
      ],
    })
    return {
      decision: 'allow' as const,
      result: { ...evaluation, receipt },
      receipt,
      seq,
      durable: true as const,
    }
  }, { retryUnique: true })
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
  const status = String(row.status)
  if (status === 'settled') throw new Error('receipt jti already settled')
  if (status === 'released') throw new Error('receipt jti expired and released')

  const upd = await c.execute({
    sql: `UPDATE site_receipts SET status = 'settled', settled_at = ?
           WHERE jti = ? AND status = 'authorized'`,
    args: [Date.now(), receipt.jti],
  })
  if (Number(upd.rowsAffected) !== 1) {
    throw new Error('receipt jti already settled, released, or missing')
  }
  return { ok: true, jti: receipt.jti, durable: true }
}

const RATE_WINDOW_MS = 60_000

/** Shared limiter for Vercel isolates. Fail closed if the caller treats a throw as deny. */
export async function durableRateLimit(
  key: string,
  maxPerWindow: number
): Promise<{ ok: true } | { ok: false }> {
  const c = await getClient()
  const now = Date.now()
  const resetAt = now + RATE_WINDOW_MS
  const rs = await c.execute({
    sql: `INSERT INTO site_rate (bucket, n, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(bucket) DO UPDATE SET
            n = CASE WHEN site_rate.reset_at <= ? THEN 1 ELSE site_rate.n + 1 END,
            reset_at = CASE WHEN site_rate.reset_at <= ? THEN excluded.reset_at ELSE site_rate.reset_at END
          RETURNING n`,
    args: [key, resetAt, now, now],
  })
  const n = Number(rs.rows[0]?.n ?? 0)
  if (Math.random() < 0.02) {
    c.execute({
      sql: 'DELETE FROM site_rate WHERE reset_at < ?',
      args: [now - 5 * RATE_WINDOW_MS],
    }).catch(() => undefined)
  }
  if (n > maxPerWindow) return { ok: false }
  return { ok: true }
}

function packCreditsPerPurchase(): number {
  const n = Number(process.env.ALLOWLATCH_CREDITS_PER_X402 || 3)
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : 3
}

export async function durableGetPackCredits(packKey: string): Promise<number> {
  const c = await getClient()
  const rs = await c.execute({
    sql: 'SELECT credits FROM site_packs WHERE pack_key = ?',
    args: [packKey],
  })
  return Number(rs.rows[0]?.credits ?? 0)
}

/** After a paid buy_pack — mint fixed credits (client cannot choose the amount). */
export async function durableAddPackCredits(packKey: string): Promise<{
  packKey: string
  added: number
  credits: number
}> {
  const key = packKey.trim()
  if (key.length < 3) throw new Error('packKey too short')
  const added = packCreditsPerPurchase()
  const c = await getClient()
  const now = Date.now()
  await c.execute({
    sql: `INSERT INTO site_packs (pack_key, credits, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(pack_key) DO UPDATE SET
            credits = site_packs.credits + excluded.credits,
            updated_at = excluded.updated_at`,
    args: [key, added, now],
  })
  return { packKey: key, added, credits: await durableGetPackCredits(key) }
}

/** Burn one prepaid evaluate credit. Returns remaining credits, or null if none. */
export async function durableTryConsumePackCredit(
  packKey: string
): Promise<number | null> {
  const key = packKey.trim()
  if (!key) return null
  const c = await getClient()
  const now = Date.now()
  const upd = await c.execute({
    sql: `UPDATE site_packs SET credits = credits - 1, updated_at = ?
           WHERE pack_key = ? AND credits > 0`,
    args: [now, key],
  })
  if (Number(upd.rowsAffected) !== 1) return null
  return durableGetPackCredits(key)
}

export async function durableHasPolicy(policyId: string): Promise<boolean> {
  return Boolean(await loadRow(policyId))
}

/** Read policy row (seq / owner / policy) for seal checks — no mutation. */
export async function durablePeekPolicy(policyId: string): Promise<{
  policyId: string
  ownerId: string
  ownerTokenHash: string
  policy: MandatePolicy
  seq: number
} | null> {
  const row = await loadRow(policyId)
  if (!row) return null
  return {
    policyId: row.policyId,
    ownerId: row.ownerId,
    ownerTokenHash: row.ownerTokenHash,
    policy: row.policy,
    seq: row.seq,
  }
}

export async function durableSetWalletBinding(
  policyId: string,
  binding: Record<string, unknown>
): Promise<void> {
  const c = await getClient()
  const now = Date.now()
  await c.execute({
    sql: `INSERT INTO site_wallet_bindings (policy_id, json, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(policy_id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`,
    args: [policyId, JSON.stringify(binding), now],
  })
}

export async function durableGetWalletBinding(
  policyId: string
): Promise<Record<string, unknown> | null> {
  const c = await getClient()
  const res = await c.execute({
    sql: 'SELECT json FROM site_wallet_bindings WHERE policy_id = ?',
    args: [policyId],
  })
  const row = res.rows[0]
  if (!row) return null
  try {
    return JSON.parse(String(row.json)) as Record<string, unknown>
  } catch {
    return null
  }
}
