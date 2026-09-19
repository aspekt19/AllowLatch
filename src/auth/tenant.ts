/**
 * Tenant / operator authorization for shared hosted gate.
 * Mutating a policy requires ownerToken (issued on first apply), valid EIP-712 ownerSig,
 * or ALLOWLATCH_OPERATOR_TOKEN.
 * Evaluate/execute stay callable with policyId only (treat policyId as a capability secret).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { MandatePolicy } from '../policy/schema.js'

export class AuthError extends Error {
  readonly code = 'auth_denied'
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export type OwnerAuthInput = {
  ownerId?: string
  ownerToken?: string
  operatorToken?: string
  /** EVM address that must match EIP-712 recovery (optional stronger path). */
  ownerAddress?: string
  /** EIP-712 MandatePolicyApply signature over policyHash. */
  ownerSig?: string
  /** Bound at verify time — set by store from pending policy. */
  policyId?: string
  policy?: MandatePolicy
}

export function isOperator(token?: string): boolean {
  const expected = process.env.ALLOWLATCH_OPERATOR_TOKEN?.trim()
  if (!expected || !token?.trim()) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(token.trim())
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function mintOwnerToken(): string {
  return randomBytes(24).toString('hex')
}

export function hashOwnerToken(token: string): string {
  return createHash('sha256').update(`allowlatch-owner-v1:${token}`).digest('hex')
}

export function ownerTokenMatches(token: string | undefined, tokenHash: string | null | undefined): boolean {
  if (!token?.trim() || !tokenHash) return false
  const got = Buffer.from(hashOwnerToken(token.trim()))
  const want = Buffer.from(tokenHash)
  if (got.length !== want.length) return false
  return timingSafeEqual(got, want)
}

export type PolicyMeta = {
  policyId: string
  ownerId: string | null
  tokenHash: string | null
  ownerAddress: string | null
}

/**
 * Authorize create/update of a policy.
 * - New policy: ownerId required (unless operator).
 * - Existing with token: ownerToken OR (ownerSig verified later in store) or operator.
 * - Existing demo seed without token: claimable once with ownerId (mints token).
 *
 * Note: EIP-712 verification is async and runs in PolicyStore.setPolicy after this sync check
 * when ownerSig is present; for update without ownerToken, set `sigPending` via allowSigBypass.
 */
export function assertPolicyWrite(
  meta: PolicyMeta | null,
  auth: OwnerAuthInput,
  opts?: { allowMissingTokenIfSig?: boolean }
): { mode: 'create' | 'claim' | 'update' | 'operator' } {
  if (isOperator(auth.operatorToken)) return { mode: 'operator' }

  if (!meta) {
    if (!auth.ownerId?.trim()) {
      throw new AuthError('ownerId required to create a policy on the shared host')
    }
    return { mode: 'create' }
  }

  if (!meta.tokenHash) {
    // Unclaimed seed (e.g. demo default) — first ownerId claims it.
    if (!auth.ownerId?.trim()) {
      throw new AuthError('ownerId required to claim this policy')
    }
    return { mode: 'claim' }
  }

  const tokenOk = ownerTokenMatches(auth.ownerToken, meta.tokenHash)
  const sigOffered = Boolean(auth.ownerSig?.trim())
  if (!tokenOk && !(opts?.allowMissingTokenIfSig && sigOffered)) {
    throw new AuthError(
      'ownerToken or EIP-712 ownerSig required (or ALLOWLATCH_OPERATOR_TOKEN) to mutate this policy'
    )
  }
  if (auth.ownerId?.trim() && meta.ownerId && auth.ownerId.trim() !== meta.ownerId) {
    throw new AuthError('ownerId does not match policy owner')
  }
  return { mode: 'update' }
}

/** Authorize reading policy/ledger/audit for a tenant. */
export function assertPolicyRead(meta: PolicyMeta | null, auth: OwnerAuthInput): void {
  if (isOperator(auth.operatorToken)) return
  if (!meta) throw new AuthError('unknown policyId')
  if (!meta.tokenHash) {
    // Public demo seed readable without token (evaluate still works).
    if (process.env.ALLOWLATCH_PUBLIC_DEMO_READ === '0') {
      throw new AuthError('ownerToken required to read this policy')
    }
    return
  }
  if (!ownerTokenMatches(auth.ownerToken, meta.tokenHash)) {
    throw new AuthError('ownerToken required to read this policy')
  }
}
