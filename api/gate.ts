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
import { siteGateApply, siteGateConfigured, siteGateEvaluate } from '../src/web/site-gate.js'
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
})

const BodySchema = z.discriminatedUnion('action', [ApplySchema, EvaluateSchema])

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
    res.status(200).json({
      ok: true,
      backend: mode,
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
            }
          : { via: 'openserv' },
      note:
        mode === 'openserv'
          ? 'POST apply|evaluate via OpenServ x402 (fallback)'
          : 'POST apply|evaluate on always-on site gate. Browser same-site free to try; agents pay $0.025 USDC x402 on Base. sessionSeal is session-scoped (not SQLite durable).',
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
    const paid = await enforceSiteGateX402({
      origin,
      headers: req.headers as Record<string, unknown>,
      resource,
    })
    if (!paid.ok) {
      res.status(paid.status).json(paid.body)
      return
    }
    settlement = paid.settlement
  }

  try {
    if (body.action === 'apply') {
      const policy = MandatePolicySchema.parse({
        ...body.policy,
        ownerId: body.ownerId,
      })

      if (mode === 'site') {
        const applied = siteGateApply({
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

    if (mode === 'site') {
      const evaluated = siteGateEvaluate({
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
        priceUsd: settlement ? String(SITE_GATE_PRICE_USD) : '0',
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
