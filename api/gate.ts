/**
 * Product path from the website: apply / evaluate against hosted AllowLatch Gate (x402).
 * Operator subsidizes the $0.025 payer key — rate-limited per IP.
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
  gateProxyConfigured,
  hostApplyPolicy,
  hostEvaluateIntent,
} from '../src/web/gate-proxy.js'
import { MandatePolicySchema, SpendIntentSchema } from '../src/policy/schema.js'

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
    res.status(200).json({
      ok: true,
      configured: gateProxyConfigured(),
      priceUsd: '0.025',
      note: 'POST { action: apply|evaluate } — hosted OpenServ Gate via x402',
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

  if (!gateProxyConfigured()) {
    res.status(503).json({
      ok: false,
      error:
        'Live gate proxy not configured (need ALLOWLATCH_TRIGGER_URL + WALLET_PRIVATE_KEY on Vercel)',
    })
    return
  }

  const ip = clientIp(
    req as unknown as { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } }
  )
  // Stricter than copilot — each call costs ~$0.025
  const rate = checkRateLimit(`gate:${ip}`, Number(process.env.ALLOWLATCH_GATE_RATE_MAX || 8))
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
      const result = await hostApplyPolicy({
        policyId: body.policyId,
        ownerId: body.ownerId,
        ownerToken: body.ownerToken,
        policy,
      })
      res.status(200).json({
        ok: true,
        action: 'apply',
        policyId: body.policyId,
        ownerId: body.ownerId,
        result,
        ownerToken:
          typeof result.ownerToken === 'string' ? result.ownerToken : body.ownerToken ?? null,
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
      policyId: body.policyId,
      decision: decision || null,
      result,
      receipt: result.receipt ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const failClosed = /DENY|unreachable|payment|not JSON|not configured/i.test(message)
    res.status(failClosed ? 502 : 500).json({
      ok: false,
      error: message,
      failClosed: true,
    })
  }
}
