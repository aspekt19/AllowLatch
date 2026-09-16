/**
 * Public host info for the demo UI (paywall URL for Enforce CTA).
 * Set ALLOWLATCH_PAYWALL_URL in .env / Vercel.
 */
export function getHostInfo() {
  return {
    paywallUrl: process.env.ALLOWLATCH_PAYWALL_URL?.trim() || null,
    priceUsd: '0.1',
    monetize: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/MONETIZE.md',
    embed: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/EMBED.md',
  }
}
