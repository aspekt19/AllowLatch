/**
 * Product path from the website: apply / evaluate.
 * Default: durable-enough site gate on Vercel (engine + receipt).
 * Optional: OpenServ x402 when ALLOWLATCH_GATE_BACKEND=openserv.
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
})

const EvaluateSchema = z.object({
  action: z.literal('evaluate'),
  policyId: z.string().min(1).max(80),
  intent: SpendIntentSchema,
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
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '600')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  setCors(res, origin)

  if (req.method === 'OPTIONS') {
    const o = checkOrigin(origin)
    if (!o.ok) {
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
      priceUsd: mode === 'openserv' ? '0.025' : '0',
      note:
        mode === 'openserv'
          ? 'POST apply|evaluate via OpenServ x402'
          : 'POST apply|evaluate on site gate (engine + receipt). Free to try from the website.',
    })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST or GET only' })
    return
  }

  const o = checkOrigin(origin)
  if (!o.ok) {
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
        })
        res.status(200).json({
          ok: true,
          action: 'apply',
          backend: 'site',
          ...applied,
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
      })
      res.status(200).json({
        ok: true,
        action: 'evaluate',
        backend: 'site',
        policyId: body.policyId,
        decision: evaluated.decision,
        result: evaluated.result,
        receipt: evaluated.receipt,
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
