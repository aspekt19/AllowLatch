/**
 * Optional EIP-712 owner signature over policyHash.
 * Complements ownerToken: a spender with only policyId cannot forge apply without the owner's key.
 */
import { createHash } from 'node:crypto'
import {
  type Address,
  type Hex,
  hashTypedData,
  recoverTypedDataAddress,
  isAddress,
  getAddress,
} from 'viem'
import type { MandatePolicy } from '../policy/schema.js'
import { AuthError } from './tenant.js'

export const POLICY_EIP712_DOMAIN = {
  name: 'AllowLatch',
  version: '1',
} as const

export const POLICY_EIP712_TYPES = {
  MandatePolicyApply: [
    { name: 'policyId', type: 'string' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'ownerId', type: 'string' },
  ],
} as const

/** Stable JSON for hashing (sorted object keys; arrays keep order). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** Full 32-byte policy digest for EIP-712 (independent of receipt hashPolicy truncation). */
export function policyHashBytes32(policy: MandatePolicy): Hex {
  const hex = createHash('sha256').update(stableStringify(policy)).digest('hex')
  return `0x${hex}`
}

export type PolicyApplyTypedData = {
  domain: typeof POLICY_EIP712_DOMAIN & { chainId?: number }
  types: typeof POLICY_EIP712_TYPES
  primaryType: 'MandatePolicyApply'
  message: {
    policyId: string
    policyHash: Hex
    ownerId: string
  }
}

export function buildPolicyApplyTypedData(args: {
  policyId: string
  policy: MandatePolicy
  ownerId: string
  chainId?: number
}): PolicyApplyTypedData {
  return {
    domain: {
      ...POLICY_EIP712_DOMAIN,
      ...(args.chainId != null ? { chainId: args.chainId } : {}),
    },
    types: POLICY_EIP712_TYPES,
    primaryType: 'MandatePolicyApply',
    message: {
      policyId: args.policyId,
      policyHash: policyHashBytes32(args.policy),
      ownerId: args.ownerId,
    },
  }
}

export function hashPolicyApplyTypedData(args: {
  policyId: string
  policy: MandatePolicy
  ownerId: string
  chainId?: number
}): Hex {
  const td = buildPolicyApplyTypedData(args)
  return hashTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: td.message,
  })
}

export async function recoverPolicyOwner(args: {
  policyId: string
  policy: MandatePolicy
  ownerId: string
  signature: Hex
  chainId?: number
}): Promise<Address> {
  const td = buildPolicyApplyTypedData(args)
  return recoverTypedDataAddress({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: td.message,
    signature: args.signature,
  })
}

/**
 * Verify optional EIP-712 ownerSig.
 * - If neither sig nor requireOwnerSig: no-op.
 * - If sig present: recover must match ownerAddress (or ownerId if it is an address).
 * - If ALLOWLATCH_REQUIRE_OWNER_SIG=1: sig required on create/update (operator exempt upstream).
 */
export async function assertOwnerPolicySig(args: {
  policyId: string
  policy: MandatePolicy
  ownerId?: string
  ownerAddress?: string
  ownerSig?: string
  storedOwnerAddress?: string | null
  requireSig?: boolean
}): Promise<{ ownerAddress: Address | null; verified: boolean }> {
  const requireSig =
    args.requireSig === true || process.env.ALLOWLATCH_REQUIRE_OWNER_SIG === '1'
  const sig = args.ownerSig?.trim() as Hex | undefined

  if (!sig) {
    if (requireSig) {
      throw new AuthError('ownerSig (EIP-712 MandatePolicyApply) required to mutate this policy')
    }
    return { ownerAddress: null, verified: false }
  }

  const ownerId = args.ownerId?.trim()
  if (!ownerId) {
    throw new AuthError('ownerId required when ownerSig is provided')
  }

  const recovered = await recoverPolicyOwner({
    policyId: args.policyId,
    policy: args.policy,
    ownerId,
    signature: sig,
  })

  const expectedRaw =
    args.ownerAddress?.trim() ||
    args.storedOwnerAddress?.trim() ||
    (isAddress(ownerId) ? ownerId : undefined)

  if (!expectedRaw || !isAddress(expectedRaw)) {
    throw new AuthError(
      'ownerAddress (or address-form ownerId) required to verify EIP-712 ownerSig'
    )
  }

  const expected = getAddress(expectedRaw)
  if (getAddress(recovered) !== expected) {
    throw new AuthError('ownerSig does not recover to ownerAddress')
  }

  return { ownerAddress: expected, verified: true }
}
