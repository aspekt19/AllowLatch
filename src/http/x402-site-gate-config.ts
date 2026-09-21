/** Shared site-gate x402 constants (safe for Vite / host-info — no Coinbase imports). */
export const SITE_GATE_PRICE_USD = 0.025
/** $0.025 USDC with 6 decimals */
export const SITE_GATE_AMOUNT_ATOMIC = '25000'
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
export const DEFAULT_SITE_GATE_PAY_TO =
  '0xa91841F98fd15e3f590e2681d7122ec04bc7F677' as const

export function siteGatePayToSync(): `0x${string}` {
  const explicit = process.env.ALLOWLATCH_X402_PAY_TO?.trim()
  if (explicit?.startsWith('0x') && explicit.length === 42) {
    return explicit as `0x${string}`
  }
  return DEFAULT_SITE_GATE_PAY_TO
}

export function x402FacilitatorConfiguredSync(): boolean {
  return Boolean(
    process.env.CDP_API_KEY_ID?.trim() && process.env.CDP_API_KEY_SECRET?.trim()
  )
}
