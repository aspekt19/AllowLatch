/**
 * Store API surface — SQLite today; swap backend without rewriting agent/HTTP.
 * Method signatures mirror PolicyStore (fs-store.ts).
 */
import type { MandatePolicy, SpendLedger } from '../policy/schema.js'
import type { OwnerAuthInput, PolicyMeta } from '../auth/tenant.js'

export type AuditEvent = {
  id: string
  at: string
  type: string
  policyId?: string
  requestId?: string
  payload: Record<string, unknown>
}

/** Minimal contract for future Postgres/Turso backends. */
export interface PolicyStoreApi {
  init(): Promise<void>
  exclusive<T>(fn: () => Promise<T> | T): Promise<T>
  getPolicy(policyId: string): MandatePolicy
  policyExists(policyId: string): boolean
  getPolicyMeta(policyId: string): PolicyMeta | null
  setPolicy(
    policyId: string,
    policy: MandatePolicy,
    ownerId?: string,
    auth?: OwnerAuthInput,
    opts?: { skipAuth?: boolean }
  ): Promise<{ ownerToken?: string; mode: string; ownerAddress?: string | null }>
  getLedger(policyId: string): SpendLedger
  setLedger(policyId: string, ledger: SpendLedger): void | Promise<void>
  resetDailyLedger(policyId: string): void | Promise<void>
  resetLedger(policyId: string): void | Promise<void>
  tryConsumeReceipt(jti: string, meta: { policyId: string; intentHash: string }): boolean
  getIdempotentResult(requestId: string): string | null
  saveIdempotentResult(requestId: string, resultJson: string): void
  getPackCredits(packKey: string): number
  addPackCredits(packKey: string, credits: number): number
  tryConsumePackCredit(packKey: string): boolean | number | null
  setWalletBinding(policyId: string, binding: Record<string, unknown>): void
  getWalletBinding(policyId: string): Record<string, unknown> | null
  audit(event: {
    type: string
    policyId?: string
    requestId?: string
    payload: Record<string, unknown>
    id?: string
    at?: string
  }): Promise<void>
  listAudit(limitOrFilter?: number | { policyId?: string; limit?: number }, policyId?: string): AuditEvent[]
}
