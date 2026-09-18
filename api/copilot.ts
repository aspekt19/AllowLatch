import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleCopilotBody } from '../src/web/copilot-handler.js'
import {
  allowedCopilotOrigins,
  checkBodySize,
  checkOrigin,
  checkRateLimit,
  clientIp,
} from '../src/http/abuse-guard.js'

export const config = {
  maxDuration: 60,
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

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' })
    return
  }

  const o = checkOrigin(origin)
  if (!o.ok) {
    res.status(o.status).json({ ok: false, error: o.error })
    return
  }

  const ip = clientIp(
    req as unknown as { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } }
  )
  const rate = checkRateLimit(`copilot:${ip}`)
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

  const { status, json } = await handleCopilotBody(req.body)
  res.status(status).json(json)
}
