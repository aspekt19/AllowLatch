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
import {
  DEFAULT_SITE_GATE_PAY_TO,
  SITE_GATE_AMOUNT_ATOMIC,
  USDC_BASE,
  x402FacilitatorConfiguredSync,
} from './x402-site-gate-config.js'

export {
  SITE_GATE_PRICE_USD,
  SITE_GATE_AMOUNT_ATOMIC,
  USDC_BASE,
} from './x402-site-gate-config.js'

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
  return DEFAULT_SITE_GATE_PAY_TO
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
    // Base USDC EIP-3009 domain — must match on-chain EIP-712 name ("USD Coin"), not the ticker.
    extra: {
      name: 'USD Coin',
      version: '2',
    },
  }
}

/** Browser demo on the AllowLatch site stays free; agents (no/foreign Origin) pay. */
export function isSiteGateFreeOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  return allowedCorsOrigins().includes(origin)
}

/**
 * Origin alone is spoofable. Treat free path as browser UX, not a paywall credential:
 * require Sec-Fetch-* signals typical of a same-site document fetch.
 * Agents / curl without these headers still pay (or get 402).
 */
export function isBrowserSiteGateRequest(headers: Record<string, unknown> | undefined): boolean {
  if (!headers) return false
  const site = String(headers['sec-fetch-site'] ?? headers['Sec-Fetch-Site'] ?? '').toLowerCase()
  const mode = String(headers['sec-fetch-mode'] ?? headers['Sec-Fetch-Mode'] ?? '').toLowerCase()
  const dest = String(headers['sec-fetch-dest'] ?? headers['Sec-Fetch-Dest'] ?? '').toLowerCase()
  // same-origin / same-site document or cors XHR from the site
  if (site === 'same-origin' || site === 'same-site') return true
  if (site === 'none' && mode === 'navigate') return false
  // Vite/dev or older browsers may omit Sec-Fetch — allow only with empty dest + cors mode + free Origin checked separately
  if (!site && (mode === 'cors' || mode === '') && (dest === 'empty' || dest === '')) {
    return process.env.ALLOWLATCH_SITE_GATE_RELAX_FETCH === '1'
  }
  return false
}

export function x402FacilitatorConfigured(): boolean {
  return x402FacilitatorConfiguredSync()
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
  // Free only for real same-site browser traffic. Spoofed Origin alone is not enough.
  if (isSiteGateFreeOrigin(args.origin) && isBrowserSiteGateRequest(args.headers)) {
    return { ok: true, free: true }
  }

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
