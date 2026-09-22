/**
 * Public host info for the product UI + agents (paywall / trigger / live status).
 * Primary enforcement: always-on Vercel /api/gate with native x402.
 * OpenServ remains an optional fallback marketplace path.
 */
import {
  SITE_GATE_PRICE_USD,
  siteGatePayToSync,
  x402FacilitatorConfiguredSync,
} from '../http/x402-site-gate-config.js'
import { tursoConfigured } from './site-gate-durable-config.js'

const DEFAULT_PAYWALL =
  'https://platform.openserv.ai/workspace/paywall/d5bd76ab6637492c8dea60fabb590b53'
const DEFAULT_TRIGGER =
  'https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53'
const DEFAULT_GATE_URL = 'https://allowlatch.vercel.app/api/gate'

/** Credits minted per paid site-gate buy_pack ($0.025). */
export function sitePackCreditsPerPurchase(): number {
  const n = Number(process.env.ALLOWLATCH_CREDITS_PER_X402 || 3)
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : 3
}

export type HostInfo = {
  /** Product surface — never "demo-ui" (that label confused reviewers about durability). */
  surface: 'product'
  priceUsd: string
  /** ~$/check when using prepaid pack credits (priceUsd / creditsPerPack). */
  packCheckUsd: string
  creditsPerPack: number
  /** End users run nothing — connect via gateUrl + x402 (or OpenServ fallback). */
  userRunsNothing: true
  /**
   * Primary always-on gate. Prefer this over `openserv`.
   * `durable: true` = Turso shared ledger (multi-instance safe).
   */
  primary: {
    kind: 'site-gate'
    gateUrl: string
    network: 'base'
    payTo: string
    priceUsd: string
    durable: boolean
    x402Facilitator: boolean
    creditsPerPack: number
  }
  /** Optional marketplace fallback — idle listing does not mean the site gate is down. */
  openserv: {
    optional: true
    paywallUrl: string
    triggerUrl: string
    workflowId: number | null
    /** OpenServ discover `isActive` only — not the Vercel site gate. */
    isActive: boolean | null
  }
  /**
   * @deprecated Prefer `primary` + `openserv`. Kept for older clients.
   * `isActive` here is OpenServ-only; check `primary.durable` for ledger mode.
   */
  gate: {
    name: string
    gateUrl: string
    payTo: string
    network: 'base'
    durable: boolean
    paywallUrl: string
    triggerUrl: string
    workflowId: number | null
    isActive: boolean | null
    x402Facilitator: boolean
  }
  docs: {
    connect: string
    guide: string
    hosted: string
    monetize: string
    embed: string
    security: string
  }
  note: string
}

let cachedActive: { at: number; value: boolean | null } = { at: 0, value: null }

async function probeOpenServActive(_triggerUrl: string): Promise<boolean | null> {
  const now = Date.now()
  if (now - cachedActive.at < 60_000) return cachedActive.value
  try {
    if (process.env.ALLOWLATCH_GATE_ACTIVE === '1') {
      cachedActive = { at: now, value: true }
      return true
    }
    if (process.env.ALLOWLATCH_GATE_ACTIVE === '0') {
      cachedActive = { at: now, value: false }
      return false
    }
    const { PlatformClient } = await import('@openserv-labs/client')
    const client = new PlatformClient()
    const services = await client.payments.discoverServices()
    const hits = (services || []).filter((s: { name?: string }) =>
      /allowlatch/i.test(s.name || '')
    ) as { isActive?: boolean; webhookUrl?: string }[]
    // Prefer the canonical listing (DEFAULT_TRIGGER id), else any active AllowLatch gate.
    const canonicalId = DEFAULT_TRIGGER.split('/').pop()
    const preferred =
      hits.find((s) => canonicalId && s.webhookUrl?.includes(canonicalId)) ||
      hits.find((s) => s.isActive === true) ||
      hits[0]
    const active = typeof preferred?.isActive === 'boolean' ? preferred.isActive : null
    cachedActive = { at: now, value: active }
    return active
  } catch {
    cachedActive = { at: now, value: null }
    return null
  }
}

function buildNote(durable: boolean, credits: number): string {
  const pack = (SITE_GATE_PRICE_USD / credits).toFixed(4)
  const base =
    'Primary: always-on https://allowlatch.vercel.app/api/gate — website Origin free to try; ' +
    `agents pay $${SITE_GATE_PRICE_USD} USDC x402 on Base (or buy_pack → ${credits} evaluates ≈ $${pack}/check). ` +
    'OpenServ discover/paywall is optional fallback. End users never run the local OpenServ host. ' +
    'Middleware without hybrid Spend Permissions is not custody-grade if the agent retains a raw key.'
  return durable
    ? base + ' Durable Turso ledger enabled on this deployment.'
    : base + ' Durable Turso ledger not configured (memory+sessionSeal demo mode).'
}

function buildHostInfo(args: {
  durable: boolean
  isActive: boolean | null
  paywallUrl: string
  triggerUrl: string
  gateUrl: string
  workflowId: number | null
}): HostInfo {
  const credits = sitePackCreditsPerPurchase()
  const price = String(SITE_GATE_PRICE_USD)
  const packCheckUsd = (SITE_GATE_PRICE_USD / credits).toFixed(4)
  return {
    surface: 'product',
    priceUsd: price,
    packCheckUsd,
    creditsPerPack: credits,
    userRunsNothing: true,
    primary: {
      kind: 'site-gate',
      gateUrl: args.gateUrl,
      network: 'base',
      payTo: siteGatePayToSync(),
      priceUsd: price,
      durable: args.durable,
      x402Facilitator: x402FacilitatorConfiguredSync(),
      creditsPerPack: credits,
    },
    openserv: {
      optional: true,
      paywallUrl: args.paywallUrl,
      triggerUrl: args.triggerUrl,
      workflowId: args.workflowId,
      isActive: args.isActive,
    },
    gate: {
      name: 'AllowLatch Gate',
      gateUrl: args.gateUrl,
      payTo: siteGatePayToSync(),
      network: 'base',
      durable: args.durable,
      paywallUrl: args.paywallUrl,
      triggerUrl: args.triggerUrl,
      workflowId: args.workflowId,
      isActive: args.isActive,
      x402Facilitator: x402FacilitatorConfiguredSync(),
    },
    docs: {
      connect: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/CONNECT.md',
      guide: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/GUIDE.md',
      hosted: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/HOSTED.md',
      monetize: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/MONETIZE.md',
      embed: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/EMBED.md',
      security: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/SECURITY.md',
    },
    note: buildNote(args.durable, credits),
  }
}

export async function getHostInfoAsync(): Promise<HostInfo> {
  const paywallUrl = process.env.ALLOWLATCH_PAYWALL_URL?.trim() || DEFAULT_PAYWALL
  const triggerUrl = process.env.ALLOWLATCH_TRIGGER_URL?.trim() || DEFAULT_TRIGGER
  const gateUrl = process.env.ALLOWLATCH_GATE_URL?.trim() || DEFAULT_GATE_URL
  const workflowRaw = process.env.ALLOWLATCH_WORKFLOW_ID?.trim()
  const workflowId = workflowRaw ? Number(workflowRaw) : null
  const isActive = await probeOpenServActive(triggerUrl)
  return buildHostInfo({
    durable: tursoConfigured(),
    isActive,
    paywallUrl,
    triggerUrl,
    gateUrl,
    workflowId: Number.isFinite(workflowId) ? workflowId : null,
  })
}

/** Sync snapshot for simple handlers (no live OpenServ probe). */
export function getHostInfo(): HostInfo {
  const paywallUrl = process.env.ALLOWLATCH_PAYWALL_URL?.trim() || DEFAULT_PAYWALL
  const triggerUrl = process.env.ALLOWLATCH_TRIGGER_URL?.trim() || DEFAULT_TRIGGER
  const gateUrl = process.env.ALLOWLATCH_GATE_URL?.trim() || DEFAULT_GATE_URL
  const workflowRaw = process.env.ALLOWLATCH_WORKFLOW_ID?.trim()
  const workflowId = workflowRaw ? Number(workflowRaw) : null
  return buildHostInfo({
    durable: tursoConfigured(),
    isActive: cachedActive.value,
    paywallUrl,
    triggerUrl,
    gateUrl,
    workflowId: Number.isFinite(workflowId) ? workflowId : null,
  })
}
