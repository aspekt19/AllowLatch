/**
 * SQLite-backed store: atomic ledger updates, receipt nonce consume, audit events.
 * Migrates from legacy data/policies.json + ledgers.json on first boot.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  DEMO_POLICY,
  MandatePolicySchema,
  type MandatePolicy,
  type SpendLedger,
} from '../policy/schema.js'
import { freshLedger } from '../policy/engine.js'
import {
  assertPolicyWrite,
  hashOwnerToken,
  mintOwnerToken,
  type OwnerAuthInput,
  type PolicyMeta,
} from '../auth/tenant.js'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const DB_PATH = (() => {
  if (process.env.ALLOWLATCH_SQLITE_PATH?.trim()) {
    return path.resolve(process.env.ALLOWLATCH_SQLITE_PATH.trim())
  }
  const preferred = path.join(DATA_DIR, 'allowlatch.sqlite')
  const legacyNames = ['legacy-store.sqlite', 'spendgate.sqlite']
  if (!existsSync(preferred)) {
    for (const name of legacyNames) {
      const candidate = path.join(DATA_DIR, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return preferred
})()


export type AuditEvent = {
  id: string
  at: string
  type: string
  policyId?: string
  requestId?: string
  payload: Record<string, unknown>
}

function openDb(): DatabaseSync {
  mkdirSync(path.dirname(DB_PATH), { recursive: true })
  mkdirSync(DATA_DIR, { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS policies (
      policy_id TEXT PRIMARY KEY,
      owner_id TEXT,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledgers (
      policy_id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts_consumed (
      jti TEXT PRIMARY KEY,
      consumed_at TEXT NOT NULL,
      policy_id TEXT,
      intent_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      policy_id TEXT,
      request_id TEXT,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      request_id TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evaluate_packs (
      pack_key TEXT PRIMARY KEY,
      credits INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_bindings (
      policy_id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  // Best-effort additive migration for tenant auth.
  try {
    db.exec('ALTER TABLE policies ADD COLUMN owner_token_hash TEXT')
  } catch {
    /* column already exists */
  }
  return db
}

function migrateFromJson(db: DatabaseSync) {
  const policiesPath = path.join(DATA_DIR, 'policies.json')
  const ledgersPath = path.join(DATA_DIR, 'ledgers.json')
  const count = db.prepare('SELECT COUNT(*) AS c FROM policies').get() as { c: number }
  if (count.c > 0) return

  if (existsSync(policiesPath)) {
    try {
      const raw = JSON.parse(readFileSync(policiesPath, 'utf8')) as Record<string, unknown>
      const insert = db.prepare(
        'INSERT OR REPLACE INTO policies (policy_id, owner_id, json, updated_at) VALUES (?, ?, ?, ?)'
      )
      for (const [id, value] of Object.entries(raw)) {
        const parsed = MandatePolicySchema.safeParse(value)
        if (parsed.success) {
          insert.run(id, parsed.data.ownerId ?? null, JSON.stringify(parsed.data), new Date().toISOString())
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (existsSync(ledgersPath)) {
    try {
      const raw = JSON.parse(readFileSync(ledgersPath, 'utf8')) as Record<string, SpendLedger>
      const insert = db.prepare('INSERT OR REPLACE INTO ledgers (policy_id, json) VALUES (?, ?)')
      for (const [id, value] of Object.entries(raw)) {
        insert.run(id, JSON.stringify(normalizeLedger(value)))
      }
    } catch {
      /* ignore */
    }
  }
}

function normalizeLedger(l: Partial<SpendLedger> | SpendLedger): SpendLedger {
  return {
    dayKey: l.dayKey ?? freshLedger().dayKey,
    spentUsdToday: l.spentUsdToday ?? 0,
    hourKey: l.hourKey ?? freshLedger().hourKey,
    txCountThisHour: l.txCountThisHour ?? 0,
    spentUsdLifetime: l.spentUsdLifetime ?? 0,
    gasUsdToday: l.gasUsdToday ?? 0,
  }
}

/** Facade used by agent / executor / HTTP gate. */
export class PolicyStore {
  private db!: DatabaseSync
  private ready = false
  /** In-process queue for serializing critical sections across async callers. */
  private chain: Promise<unknown> = Promise.resolve()

  async init() {
    this.db = openDb()
    migrateFromJson(this.db)
    const row = this.db.prepare('SELECT policy_id FROM policies WHERE policy_id = ?').get('default')
    if (!row) {
      await this.setPolicy('default', DEMO_POLICY, DEMO_POLICY.ownerId, undefined, { skipAuth: true })
    }
    this.ready = true
  }

  private assertReady() {
    if (!this.ready) throw new Error('PolicyStore not initialized')
  }

  /** Run fn exclusively (process-local) inside a SQLite transaction when possible. */
  async exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      this.assertReady()
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn()
        this.db.exec('COMMIT')
        return result
      } catch (err) {
        try {
          this.db.exec('ROLLBACK')
        } catch {
          /* ignore */
        }
        throw err
      }
    })
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  getPolicy(policyId: string): MandatePolicy {
    this.assertReady()
    const row = this.db.prepare('SELECT json FROM policies WHERE policy_id = ?').get(policyId) as
      | { json: string }
      | undefined
    if (!row) throw new Error(`Unknown policyId "${policyId}". Compile a mandate first.`)
    return MandatePolicySchema.parse(JSON.parse(row.json))
  }

  policyExists(policyId: string): boolean {
    this.assertReady()
    const row = this.db.prepare('SELECT policy_id FROM policies WHERE policy_id = ?').get(policyId)
    return !!row
  }

  getPolicyMeta(policyId: string): PolicyMeta | null {
    this.assertReady()
    const row = this.db
      .prepare('SELECT policy_id, owner_id, owner_token_hash FROM policies WHERE policy_id = ?')
      .get(policyId) as
      | { policy_id: string; owner_id: string | null; owner_token_hash: string | null }
      | undefined
    if (!row) return null
    return {
      policyId: row.policy_id,
      ownerId: row.owner_id,
      tokenHash: row.owner_token_hash,
    }
  }

  /**
   * Persist policy. Requires tenant auth for create/update on shared hosts.
   * Returns ownerToken only when newly minted (create/claim) — store it client-side.
   */
  async setPolicy(
    policyId: string,
    policy: MandatePolicy,
    ownerId?: string,
    auth?: OwnerAuthInput,
    opts?: { skipAuth?: boolean }
  ): Promise<{ ownerToken?: string; mode: string }> {
    this.assertReady()
    const meta = this.getPolicyMeta(policyId)
    const authInput: OwnerAuthInput = {
      ownerId: ownerId ?? policy.ownerId ?? auth?.ownerId,
      ownerToken: auth?.ownerToken,
      operatorToken: auth?.operatorToken,
    }
    // Default ON for hosted safety. Local demos/tests: ALLOWLATCH_TENANT_AUTH=0 or skipAuth.
    const tenantAuth = !opts?.skipAuth && process.env.ALLOWLATCH_TENANT_AUTH !== '0'
    let mode = 'legacy'
    let ownerToken: string | undefined
    let tokenHash: string | null = meta?.tokenHash ?? null
    let owner = authInput.ownerId ?? meta?.ownerId ?? null

    if (tenantAuth) {
      const decision = assertPolicyWrite(meta, authInput)
      mode = decision.mode
      if (decision.mode === 'create' || decision.mode === 'claim') {
        ownerToken = mintOwnerToken()
        tokenHash = hashOwnerToken(ownerToken)
        owner = authInput.ownerId!.trim()
      } else if (decision.mode === 'update' || decision.mode === 'operator') {
        owner = authInput.ownerId?.trim() || meta?.ownerId || owner
        tokenHash = meta?.tokenHash ?? tokenHash
      }
    } else {
      owner = ownerId ?? policy.ownerId ?? meta?.ownerId ?? null
      mode = 'open'
    }

    const stored: MandatePolicy = { ...policy, ownerId: owner ?? policy.ownerId }
    this.db
      .prepare(
        'INSERT OR REPLACE INTO policies (policy_id, owner_id, owner_token_hash, json, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(policyId, owner, tokenHash, JSON.stringify(stored), new Date().toISOString())
    const existing = this.db.prepare('SELECT json FROM ledgers WHERE policy_id = ?').get(policyId)
    if (!existing) {
      this.db
        .prepare('INSERT INTO ledgers (policy_id, json) VALUES (?, ?)')
        .run(policyId, JSON.stringify(freshLedger()))
    }
    await this.audit({
      type: 'policy.applied',
      policyId,
      payload: { name: policy.name, ownerId: owner, mode },
    })
    return { ownerToken, mode }
  }

  getLedger(policyId: string): SpendLedger {
    this.assertReady()
    const row = this.db.prepare('SELECT json FROM ledgers WHERE policy_id = ?').get(policyId) as
      | { json: string }
      | undefined
    if (!row) {
      const fresh = freshLedger()
      this.db
        .prepare('INSERT INTO ledgers (policy_id, json) VALUES (?, ?)')
        .run(policyId, JSON.stringify(fresh))
      return fresh
    }
    return normalizeLedger(JSON.parse(row.json))
  }

  async setLedger(policyId: string, ledger: SpendLedger) {
    this.assertReady()
    this.db
      .prepare('INSERT OR REPLACE INTO ledgers (policy_id, json) VALUES (?, ?)')
      .run(policyId, JSON.stringify(normalizeLedger(ledger)))
  }

  /**
   * Reset day/hour windows only. Lifetime budget is preserved (security invariant).
   * Full lifetime wipe requires ALLOWLATCH_RESET_LIFETIME=1 + operator path.
   */
  async resetDailyLedger(policyId: string) {
    const prev = this.getLedger(policyId)
    const fresh = freshLedger()
    await this.setLedger(policyId, {
      ...fresh,
      spentUsdLifetime: prev.spentUsdLifetime,
    })
    await this.audit({
      type: 'ledger.reset_daily',
      policyId,
      payload: { preservedLifetimeUsd: prev.spentUsdLifetime },
    })
  }

  /** @deprecated Prefer resetDailyLedger. Lifetime wipe only when ALLOWLATCH_RESET_LIFETIME=1. */
  async resetLedger(policyId: string) {
    if (process.env.ALLOWLATCH_RESET_LIFETIME === '1') {
      await this.setLedger(policyId, freshLedger())
      await this.audit({ type: 'ledger.reset_lifetime', policyId, payload: {} })
      return
    }
    await this.resetDailyLedger(policyId)
  }

  /** Returns false if jti already consumed (replay). */
  tryConsumeReceipt(jti: string, meta: { policyId: string; intentHash: string }): boolean {
    this.assertReady()
    const existing = this.db.prepare('SELECT jti FROM receipts_consumed WHERE jti = ?').get(jti)
    if (existing) return false
    this.db
      .prepare(
        'INSERT INTO receipts_consumed (jti, consumed_at, policy_id, intent_hash) VALUES (?, ?, ?, ?)'
      )
      .run(jti, new Date().toISOString(), meta.policyId, meta.intentHash)
    return true
  }

  getIdempotentResult(requestId: string): string | null {
    this.assertReady()
    const row = this.db.prepare('SELECT result_json FROM idempotency WHERE request_id = ?').get(requestId) as
      | { result_json: string }
      | undefined
    return row?.result_json ?? null
  }

  saveIdempotentResult(requestId: string, resultJson: string) {
    this.assertReady()
    this.db
      .prepare(
        'INSERT OR REPLACE INTO idempotency (request_id, result_json, created_at) VALUES (?, ?, ?)'
      )
      .run(requestId, resultJson, new Date().toISOString())
  }

  /** Prepaid evaluate credits ($1 ≈ 100 checks). packKey = payer wallet or API client id. */
  getPackCredits(packKey: string): number {
    this.assertReady()
    const row = this.db
      .prepare('SELECT credits FROM evaluate_packs WHERE pack_key = ?')
      .get(packKey) as { credits: number } | undefined
    return row?.credits ?? 0
  }

  addPackCredits(packKey: string, credits: number) {
    this.assertReady()
    const next = this.getPackCredits(packKey) + Math.max(0, Math.floor(credits))
    this.db
      .prepare(
        'INSERT OR REPLACE INTO evaluate_packs (pack_key, credits, updated_at) VALUES (?, ?, ?)'
      )
      .run(packKey, next, new Date().toISOString())
    return next
  }

  /** Returns remaining credits after consume, or null if empty. */
  tryConsumePackCredit(packKey: string): number | null {
    this.assertReady()
    const current = this.getPackCredits(packKey)
    if (current <= 0) return null
    const next = current - 1
    this.db
      .prepare(
        'INSERT OR REPLACE INTO evaluate_packs (pack_key, credits, updated_at) VALUES (?, ?, ?)'
      )
      .run(packKey, next, new Date().toISOString())
    return next
  }

  setWalletBinding(policyId: string, binding: Record<string, unknown>) {
    this.assertReady()
    this.db
      .prepare(
        'INSERT OR REPLACE INTO wallet_bindings (policy_id, json, updated_at) VALUES (?, ?, ?)'
      )
      .run(policyId, JSON.stringify(binding), new Date().toISOString())
  }

  getWalletBinding(policyId: string): Record<string, unknown> | null {
    this.assertReady()
    const row = this.db
      .prepare('SELECT json FROM wallet_bindings WHERE policy_id = ?')
      .get(policyId) as { json: string } | undefined
    if (!row) return null
    return JSON.parse(row.json) as Record<string, unknown>
  }

  async audit(event: Omit<AuditEvent, 'id' | 'at'> & { id?: string; at?: string }) {
    this.assertReady()
    const id = event.id ?? randomUUID()
    const at = event.at ?? new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO audit_events (id, at, type, policy_id, request_id, payload) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        at,
        event.type,
        event.policyId ?? null,
        event.requestId ?? null,
        JSON.stringify(event.payload)
      )
  }

  listAudit(limit = 50, policyId?: string): AuditEvent[] {
    this.assertReady()
    const rows = (
      policyId
        ? this.db
            .prepare(
              'SELECT id, at, type, policy_id, request_id, payload FROM audit_events WHERE policy_id = ? ORDER BY at DESC LIMIT ?'
            )
            .all(policyId, limit)
        : this.db
            .prepare(
              'SELECT id, at, type, policy_id, request_id, payload FROM audit_events ORDER BY at DESC LIMIT ?'
            )
            .all(limit)
    ) as Array<{
      id: string
      at: string
      type: string
      policy_id: string | null
      request_id: string | null
      payload: string
    }>
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      type: r.type,
      policyId: r.policy_id ?? undefined,
      requestId: r.request_id ?? undefined,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
    }))
  }
}
