/**
 * Public host info for the demo UI + agents (paywall / trigger / live status).
 * End users never run the OpenServ host — they discover + pay this gate.
 */
const DEFAULT_PAYWALL =
  'https://platform.openserv.ai/workspace/paywall/d5bd76ab6637492c8dea60fabb590b53'
const DEFAULT_TRIGGER =
  'https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53'

export type HostInfo = {
  surface: 'demo-ui'
  priceUsd: string
  /** End users run nothing — connect via OpenServ x402. */
  userRunsNothing: true
  gate: {
    name: string
    paywallUrl: string
    triggerUrl: string
    workflowId: number | null
    /** From last OpenServ discover probe (null if unset / unreachable). */
    isActive: boolean | null
  }
  docs: {
    connect: string
    hosted: string
    monetize: string
    embed: string
    security: string
  }
  note: string
}

let cachedActive: { at: number; value: boolean | null } = { at: 0, value: null }

async function probeGateActive(triggerUrl: string): Promise<boolean | null> {
  const now = Date.now()
  if (now - cachedActive.at < 60_000) return cachedActive.value
  try {
    // Discover is authoritative for isActive; fall back to env override.
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
    const active =
      typeof hit?.isActive === 'boolean'
        ? hit.isActive
        : hit?.webhookUrl
          ? true
          : null
    cachedActive = { at: now, value: active }
    return active
  } catch {
    // Demo UI must stay up even if discover fails.
    cachedActive = { at: now, value: null }
    return null
  }
}

export async function getHostInfoAsync(): Promise<HostInfo> {
  const paywallUrl = process.env.ALLOWLATCH_PAYWALL_URL?.trim() || DEFAULT_PAYWALL
  const triggerUrl = process.env.ALLOWLATCH_TRIGGER_URL?.trim() || DEFAULT_TRIGGER
  const workflowRaw = process.env.ALLOWLATCH_WORKFLOW_ID?.trim()
  const workflowId = workflowRaw ? Number(workflowRaw) : null
  const isActive = await probeGateActive(triggerUrl)

  return {
    surface: 'demo-ui',
    priceUsd: '0.025',
    userRunsNothing: true,
    gate: {
      name: 'AllowLatch Gate',
      paywallUrl,
      triggerUrl,
      workflowId: Number.isFinite(workflowId) ? workflowId : null,
      isActive,
    },
    docs: {
      connect: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/CONNECT.md',
      hosted: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/HOSTED.md',
      monetize: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/MONETIZE.md',
      embed: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/EMBED.md',
      security: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/SECURITY.md',
    },
    note:
      'You never run npm run dev. Discover AllowLatch Gate on OpenServ (or use paywall/triggerUrl here), pay $0.025, get allow-receipt. allowlatch.vercel.app is the demo UI only.',
  }
}

/** Sync snapshot for simple handlers (no live probe). */
export function getHostInfo(): HostInfo {
  const paywallUrl = process.env.ALLOWLATCH_PAYWALL_URL?.trim() || DEFAULT_PAYWALL
  const triggerUrl = process.env.ALLOWLATCH_TRIGGER_URL?.trim() || DEFAULT_TRIGGER
  const workflowRaw = process.env.ALLOWLATCH_WORKFLOW_ID?.trim()
  const workflowId = workflowRaw ? Number(workflowRaw) : null
  return {
    surface: 'demo-ui',
    priceUsd: '0.025',
    userRunsNothing: true,
    gate: {
      name: 'AllowLatch Gate',
      paywallUrl,
      triggerUrl,
      workflowId: Number.isFinite(workflowId) ? workflowId : null,
      isActive: cachedActive.value,
    },
    docs: {
      connect: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/CONNECT.md',
      hosted: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/HOSTED.md',
      monetize: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/MONETIZE.md',
      embed: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/EMBED.md',
      security: 'https://github.com/aspekt19/AllowLatch/blob/main/docs/SECURITY.md',
    },
    note:
      'You never run npm run dev. Discover AllowLatch Gate on OpenServ (or use paywall/triggerUrl here), pay $0.025, get allow-receipt. allowlatch.vercel.app is the demo UI only.',
  }
}
