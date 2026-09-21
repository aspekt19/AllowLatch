/**
 * Native x402 (Base USDC) for the always-on Vercel site gate.
 * Website browser Origin → free try. Agent / no-Origin → $0.025 exact.
 * OpenServ x402 remains an optional fallback path in assertSpend.
 */
import { createFacilitatorConfig } from '@coinbase/x402'
import { useFacilitator } from 'x402/verify'
import { exact } from 'x402/schemes'
import type { PaymentRequirements } from 'x402/types'
import { privateKeyToAccount } from 'viem/accounts'
import { allowedCorsOrigins } from './abuse-guard.js'

export const SITE_GATE_PRICE_USD = 0.025
/** $0.025 USDC with 6 decimals */
export const SITE_GATE_AMOUNT_ATOMIC = '25000'
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const

export function siteGatePayTo(): `0x${string}` {
  const explicit = process.env.ALLOWLATCH_X402_PAY_TO?.trim()
  if (explicit?.startsWith('0x') && explicit.length === 42) {
    return explicit as `0x${string}`
  }
  const pk = process.env.WALLET_PRIVATE_KEY?.trim()
  if (pk) {
    const hex = (pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`
    return privateKeyToAccount(hex).address
  }
  // Documented operator fee address (live Base settlements)
  return '0xa91841F98fd15e3f590e2681d7122ec04bc7F677'
}

export function buildSiteGateRequirements(resource: string): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'base',
    maxAmountRequired: SITE_GATE_AMOUNT_ATOMIC,
    resource,
    description: 'AllowLatch always-on gate (apply/evaluate + allow-receipt)',
    mimeType: 'application/json',
    payTo: siteGatePayTo(),
    maxTimeoutSeconds: 120,
    asset: USDC_BASE,
    extra: {
      name: 'USDC',
      version: '2',
    },
  }
}

/** Browser demo on the AllowLatch site stays free; agents (no/foreign Origin) pay. */
export function isSiteGateFreeOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  return allowedCorsOrigins().includes(origin)
}

export function x402FacilitatorConfigured(): boolean {
  return Boolean(
    process.env.CDP_API_KEY_ID?.trim() && process.env.CDP_API_KEY_SECRET?.trim()
  )
}

export type X402GateResult =
  | { ok: true; free: boolean; settlement?: string }
  | { ok: false; status: 402 | 503; body: Record<string, unknown> }

function paymentHeaderFrom(
  headers: Record<string, unknown> | undefined
): string | undefined {
  if (!headers) return undefined
  const raw =
    headers['x-payment'] ??
    headers['X-PAYMENT'] ??
    headers['X-Payment'] ??
    headers['payment-signature']
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim()
  return undefined
}

/**
 * Enforce x402 unless the request is a free browser Origin.
 */
export async function enforceSiteGateX402(args: {
  origin: string | undefined
  headers: Record<string, unknown> | undefined
  resource: string
}): Promise<X402GateResult> {
  if (isSiteGateFreeOrigin(args.origin)) {
    return { ok: true, free: true }
  }

  // Explicit opt-out for local/dev only
  if (process.env.ALLOWLATCH_SITE_GATE_X402 === '0') {
    return { ok: true, free: true }
  }

  const requirements = buildSiteGateRequirements(args.resource)
  const paymentHeader = paymentHeaderFrom(args.headers)

  if (!paymentHeader) {
    return {
      ok: false,
      status: 402,
      body: {
        x402Version: 1,
        error: 'Payment required — $0.025 USDC on Base (exact)',
        accepts: [requirements],
      },
    }
  }

  if (!x402FacilitatorConfigured()) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        error: 'Site gate x402 facilitator not configured (CDP_API_KEY_ID / CDP_API_KEY_SECRET)',
        accepts: [requirements],
      },
    }
  }

  try {
    const payload = exact.evm.decodePayment(paymentHeader)
    const facilitator = createFacilitatorConfig(
      process.env.CDP_API_KEY_ID,
      process.env.CDP_API_KEY_SECRET
    )
    const { verify, settle } = useFacilitator(facilitator)
    const verified = await verify(payload, requirements)
    if (!verified.isValid) {
      return {
        ok: false,
        status: 402,
        body: {
          x402Version: 1,
          error: verified.invalidReason || 'invalid_payment',
          accepts: [requirements],
        },
      }
    }
    const settled = await settle(payload, requirements)
    if (!settled.success) {
      return {
        ok: false,
        status: 402,
        body: {
          x402Version: 1,
          error: settled.errorReason || 'settlement_failed',
          accepts: [requirements],
        },
      }
    }
    return {
      ok: true,
      free: false,
      settlement:
        typeof settled.transaction === 'string' ? settled.transaction : undefined,
    }
  } catch (err) {
    return {
      ok: false,
      status: 402,
      body: {
        x402Version: 1,
        error: err instanceof Error ? err.message : 'payment_verify_error',
        accepts: [requirements],
      },
    }
  }
}
