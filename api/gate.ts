/**
 * Product path from the website: apply / evaluate.
 * Always-on Vercel site gate (engine + receipt) with native Base USDC x402 for agents.
 * Browser Origin on allowlatch.vercel.app stays free to try.
 * OpenServ x402 remains optional fallback (ALLOWLATCH_GATE_BACKEND=openserv or assertSpend triggerUrl).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import {
  allowedCopilotOrigins,
  checkBodySize,
  checkOrigin,
  checkRateLimit,
  clientIp,
} from '../src/http/abuse-guard.js'
import {
  enforceSiteGateX402,
  SITE_GATE_PRICE_USD,
  siteGatePayTo,
  x402FacilitatorConfigured,
} from '../src/http/x402-site-gate.js'
import { MandatePolicySchema, SpendIntentSchema } from '../src/policy/schema.js'
import {
  siteGateApply,
  siteGateBuyPack,
  siteGateConfigured,
  siteGateConsume,
  siteGateDurable,
  siteGateEvaluate,
  siteGateTryConsumePack,
} from '../src/web/site-gate.js'
import { durableRateLimit } from '../src/web/site-gate-durable.js'
import { sitePackCreditsPerPurchase } from '../src/web/host-info-data.js'
import {
  gateProxyConfigured,
  hostApplyPolicy,
  hostEvaluateIntent,
} from '../src/web/gate-proxy.js'

export const config = {
  maxDuration: 60,
}

const ApplySchema = z.object({
  action: z.literal('apply'),
  policyId: z.string().min(1).max(80).default('web-default'),
  ownerId: z.string().min(1).max(120),
  ownerToken: z.string().optional(),
  policy: z.record(z.unknown()),
  /** HMAC session blob — survives Vercel cold starts when sent back from the browser. */
  sessionSeal: z.string().max(50_000).optional(),
})

const EvaluateSchema = z.object({
  action: z.literal('evaluate'),
  policyId: z.string().min(1).max(80),
  intent: SpendIntentSchema,
  sessionSeal: z.string().max(50_000).optional(),
  /** Prepaid evaluate credit from buy_pack — burns 1 instead of paying x402. */
  packKey: z.string().min(3).max(120).optional(),
})

const ConsumeSchema = z.object({
  action: z.literal('consume'),
  policyId: z.string().min(1).max(80),
  receipt: z.record(z.unknown()),
  intent: SpendIntentSchema.optional(),
})

const BuyPackSchema = z.object({
  action: z.literal('buy_pack'),
  /** Payer wallet / client id — credits bind to this key. */
  packKey: z.string().min(3).max(120),
})

const BodySchema = z.discriminatedUnion('action', [
  ApplySchema,
  EvaluateSchema,
  ConsumeSchema,
  BuyPackSchema,
])

function backend(): 'site' | 'openserv' {
  const raw = (process.env.ALLOWLATCH_GATE_BACKEND || 'site').trim().toLowerCase()
  if (raw === 'openserv') return 'openserv'
  return 'site'
}

function setCors(res: VercelResponse, origin: string | undefined) {
  const allowed = allowedCopilotOrigins()
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-PAYMENT, X-Payment, Payment-Signature'
  )
  res.setHeader('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE')
  res.setHeader('Access-Control-Max-Age', '600')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  setCors(res, origin)

  if (req.method === 'OPTIONS') {
    const o = checkOrigin(origin)
    if (!o.ok && origin) {
      res.status(o.status).json({ ok: false, error: o.error })
      return
    }
    res.status(204).end()
    return
  }

  if (req.method === 'GET') {
    const mode = backend()
    const durable = mode === 'site' && siteGateDurable()
    res.status(200).json({
      ok: true,
      backend: mode,
      durable,
      configured:
        mode === 'openserv' ? gateProxyConfigured() : siteGateConfigured(),
      priceUsd: String(SITE_GATE_PRICE_USD),
      payTo: siteGatePayTo(),
      x402:
        mode === 'site'
          ? {
              network: 'base',
              asset: 'USDC',
              amountUsd: SITE_GATE_PRICE_USD,
              freeForWebsiteOrigin: true,
              facilitator: x402FacilitatorConfigured(),
              creditsPerPack: sitePackCreditsPerPurchase(),
              buyPack: 'POST action=buy_pack + packKey (paid) then evaluate with packKey',
            }
          : { via: 'openserv' },
      note:
        mode === 'openserv'
          ? 'POST apply|evaluate via OpenServ x402 (fallback)'
          : durable
            ? 'POST apply|evaluate|consume|buy_pack — Turso durable ledger. Browser same-site free; agents pay $0.025 or burn pack credits (~$0.008/check).'
            : 'POST apply|evaluate — memory+sessionSeal (demo). Set ALLOWLATCH_TURSO_DATABASE_URL for durable multi-instance ledger. Browser same-site free; agents pay $0.025 USDC x402.',
    })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST or GET only' })
    return
  }

  const o = checkOrigin(origin)
  if (!o.ok && origin) {
    res.status(o.status).json({ ok: false, error: o.error })
    return
  }

  const mode = backend()
  if (mode === 'openserv' && !gateProxyConfigured()) {
    res.status(503).json({
      ok: false,
      error: 'OpenServ gate proxy not configured',
    })
    return
  }
  if (mode === 'site' && !siteGateConfigured()) {
    res.status(503).json({
      ok: false,
      error: 'Site gate needs ALLOWLATCH_RECEIPT_SECRET or SERV_API_KEY',
    })
    return
  }

  const ip = clientIp(
    req as unknown as { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } }
  )
  const rateMax = mode === 'openserv' ? Number(process.env.ALLOWLATCH_GATE_RATE_MAX || 8) : 40
  const rate = checkRateLimit(`gate:${ip}`, rateMax)
  if (!rate.ok) {
    res.setHeader('Retry-After', '60')
    res.status(rate.status).json({ ok: false, error: rate.error })
    return
  }
  if (mode === 'site' && siteGateDurable()) {
    try {
      const shared = await durableRateLimit(`gate:${ip}`, rateMax)
      if (!shared.ok) {
        res.setHeader('Retry-After', '60')
        res.status(429).json({
          ok: false,
          error: `Rate limit exceeded (${rateMax}/min). Try again shortly.`,
        })
        return
      }
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Gate rate limiter unavailable (fail-closed)',
        failClosed: true,
      })
      return
    }
  }

  const size = checkBodySize(req.body)
  if (!size.ok) {
    res.status(size.status).json({ ok: false, error: size.error })
    return
  }

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(req.body)
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid body',
    })
    return
  }

  let settlement: string | undefined
  let packCreditsRemaining: number | null = null
  let paidVia: 'free' | 'x402' | 'pack' = 'free'
  if (mode === 'site') {
    const host =
      (typeof req.headers['x-forwarded-host'] === 'string'
        ? req.headers['x-forwarded-host']
        : typeof req.headers.host === 'string'
          ? req.headers.host
          : 'allowlatch.vercel.app') || 'allowlatch.vercel.app'
    const proto =
      typeof req.headers['x-forwarded-proto'] === 'string'
        ? req.headers['x-forwarded-proto']
        : 'https'
    const resource = `${proto}://${host}/api/gate`

    const packKey =
      body.action === 'evaluate' || body.action === 'buy_pack'
        ? body.packKey?.trim()
        : undefined

    if (body.action === 'evaluate' && packKey && siteGateDurable()) {
      const remaining = await siteGateTryConsumePack(packKey)
      if (remaining != null) {
        packCreditsRemaining = remaining
        paidVia = 'pack'
      }
    }

    if (paidVia !== 'pack') {
      const paid = await enforceSiteGateX402({
        origin,
        headers: req.headers as Record<string, unknown>,
        resource,
      })
      if (!paid.ok) {
        res.status(paid.status).json({
          ...paid.body,
          ...(packKey
            ? {
                hint: 'No pack credits for packKey — call buy_pack ($0.025) or pay this evaluate',
                packKey,
              }
            : {}),
        })
        return
      }
      settlement = paid.settlement
      paidVia = paid.free ? 'free' : 'x402'
    }
  }

  try {
    if (body.action === 'buy_pack') {
      if (mode !== 'site' || !siteGateDurable()) {
        res.status(400).json({
          ok: false,
          error: 'buy_pack requires durable site gate (Turso)',
        })
        return
      }
      if (paidVia !== 'x402') {
        res.status(402).json({
          ok: false,
          error: 'buy_pack requires $0.025 USDC x402 payment (not free Origin, not pack credits)',
          priceUsd: String(SITE_GATE_PRICE_USD),
        })
        return
      }
      const minted = await siteGateBuyPack(body.packKey)
      res.status(200).json({
        ok: true,
        action: 'buy_pack',
        backend: 'site',
        ...minted,
        priceUsd: String(SITE_GATE_PRICE_USD),
        settlement: settlement ?? null,
        note: `Each paid buy_pack grants ${minted.added} evaluate credits. Pass packKey on evaluate to burn one.`,
      })
      return
    }

    if (body.action === 'apply') {
      const policy = MandatePolicySchema.parse({
        ...body.policy,
        ownerId: body.ownerId,
      })

      if (mode === 'site') {
        const applied = await siteGateApply({
          policyId: body.policyId,
          ownerId: body.ownerId,
          ownerToken: body.ownerToken,
          policy,
          sessionSeal: body.sessionSeal,
        })
        const { ok: _ok, ...appliedRest } = applied
        res.status(200).json({
          ok: true,
          action: 'apply',
          backend: 'site',
          priceUsd: settlement ? String(SITE_GATE_PRICE_USD) : '0',
          settlement: settlement ?? null,
          ...appliedRest,
        })
        return
      }

      const result = await hostApplyPolicy({
        policyId: body.policyId,
        ownerId: body.ownerId,
        ownerToken: body.ownerToken,
        policy,
      })
      res.status(200).json({
        ok: true,
        action: 'apply',
        backend: 'openserv',
        policyId: body.policyId,
        ownerId: body.ownerId,
        result,
        ownerToken:
          typeof result.ownerToken === 'string' ? result.ownerToken : body.ownerToken ?? null,
      })
      return
    }

    if (body.action === 'consume') {
      if (mode !== 'site') {
        res.status(400).json({ ok: false, error: 'consume is site-gate only' })
        return
      }
      const consumed = await siteGateConsume({
        policyId: body.policyId,
        receipt: body.receipt,
        intent: body.intent,
      })
      res.status(200).json({
        action: 'consume',
        backend: 'site',
        ...consumed,
        priceUsd: settlement ? String(SITE_GATE_PRICE_USD) : '0',
        settlement: settlement ?? null,
      })
      return
    }

    if (mode === 'site') {
      const evaluated = await siteGateEvaluate({
        policyId: body.policyId,
        intent: body.intent,
        sessionSeal: body.sessionSeal,
      })
      res.status(200).json({
        ok: true,
        action: 'evaluate',
        backend: 'site',
        policyId: body.policyId,
        decision: evaluated.decision,
        result: evaluated.result,
        receipt: evaluated.receipt,
        sessionSeal: evaluated.sessionSeal,
        durable: evaluated.durable,
        packCreditsRemaining,
        paidVia,
        priceUsd:
          paidVia === 'x402'
            ? String(SITE_GATE_PRICE_USD)
            : paidVia === 'pack'
              ? '0'
              : '0',
        settlement: settlement ?? null,
      })
      return
    }

    const result = await hostEvaluateIntent({
      policyId: body.policyId,
      intent: body.intent,
    })
    const decision = String(result.decision ?? '').toLowerCase()
    res.status(200).json({
      ok: true,
      action: 'evaluate',
      backend: 'openserv',
      policyId: body.policyId,
      decision: decision || null,
      result,
      receipt: result.receipt ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(502).json({
      ok: false,
      error: message,
      failClosed: true,
    })
  }
}
