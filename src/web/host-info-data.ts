/**
 * Public host info for the demo UI + agents (paywall / trigger / live status).
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

export type HostInfo = {
  surface: 'demo-ui'
  priceUsd: string
  /** End users run nothing — connect via gateUrl + x402 (or OpenServ fallback). */
  userRunsNothing: true
  gate: {
    name: string
    /** Always-on primary */
    gateUrl: string
    payTo: string
    network: 'base'
    /** Turso-backed shared ledger when configured on the deployment */
    durable: boolean
    /** OpenServ fallback URLs */
    paywallUrl: string
    triggerUrl: string
    workflowId: number | null
    /** From last OpenServ discover probe (null if unset / unreachable). Fallback only. */
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

async function probeGateActive(_triggerUrl: string): Promise<boolean | null> {
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
    const hit = (services || []).find((s: { name?: string }) =>
      /allowlatch/i.test(s.name || '')
    ) as { isActive?: boolean; webhookUrl?: string } | undefined
    const active = typeof hit?.isActive === 'boolean' ? hit.isActive : null
    cachedActive = { at: now, value: active }
    return active
  } catch {
    cachedActive = { at: now, value: null }
    return null
  }
}

const NOTE =
  'Primary: always-on https://allowlatch.vercel.app/api/gate — website Origin free to try; agents pay $0.025 USDC x402 on Base. OpenServ discover/paywall is optional fallback when you set triggerUrl. End users never run the local OpenServ host.'

export async function getHostInfoAsync(): Promise<HostInfo> {
  const paywallUrl = process.env.ALLOWLATCH_PAYWALL_URL?.trim() || DEFAULT_PAYWALL
  const triggerUrl = process.env.ALLOWLATCH_TRIGGER_URL?.trim() || DEFAULT_TRIGGER
  const gateUrl = process.env.ALLOWLATCH_GATE_URL?.trim() || DEFAULT_GATE_URL
  const workflowRaw = process.env.ALLOWLATCH_WORKFLOW_ID?.trim()
  const workflowId = workflowRaw ? Number(workflowRaw) : null
  const isActive = await probeGateActive(triggerUrl)
  const durable = tursoConfigured()

  return {
    surface: 'demo-ui',
    priceUsd: String(SITE_GATE_PRICE_USD),
    userRunsNothing: true,
    gate: {
      name: 'AllowLatch Gate',
      gateUrl,
      payTo: siteGatePayToSync(),
      network: 'base',
      durable,
      paywallUrl,
      triggerUrl,
      workflowId: Number.isFinite(workflowId) ? workflowId : null,
      isActive,
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
    note: durable
      ? NOTE + ' Durable Turso ledger enabled on this deployment.'
      : NOTE + ' Durable Turso ledger not configured (memory+sessionSeal demo mode).',
  }
}

/** Sync snapshot for simple handlers (no live probe). */
export function getHostInfo(): HostInfo {
  const paywallUrl = process.env.ALLOWLATCH_PAYWALL_URL?.trim() || DEFAULT_PAYWALL
  const triggerUrl = process.env.ALLOWLATCH_TRIGGER_URL?.trim() || DEFAULT_TRIGGER
  const gateUrl = process.env.ALLOWLATCH_GATE_URL?.trim() || DEFAULT_GATE_URL
  const workflowRaw = process.env.ALLOWLATCH_WORKFLOW_ID?.trim()
  const workflowId = workflowRaw ? Number(workflowRaw) : null
  const durable = tursoConfigured()
  return {
    surface: 'demo-ui',
    priceUsd: String(SITE_GATE_PRICE_USD),
    userRunsNothing: true,
    gate: {
      name: 'AllowLatch Gate',
      gateUrl,
      payTo: siteGatePayToSync(),
      network: 'base',
      durable,
      paywallUrl,
      triggerUrl,
      workflowId: Number.isFinite(workflowId) ? workflowId : null,
      isActive: cachedActive.value,
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
    note: durable
      ? NOTE + ' Durable Turso ledger enabled on this deployment.'
      : NOTE + ' Durable Turso ledger not configured (memory+sessionSeal demo mode).',
  }
}
