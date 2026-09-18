import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHostInfo } from './host-info-data.js'
import { allowedCopilotOrigins, checkRateLimit, clientIp } from './abuse-guard.js'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  if (origin && allowedCopilotOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }

  const ip = clientIp(
    req as unknown as { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } }
  )
  const rate = checkRateLimit(`host-info:${ip}`, 60)
  if (!rate.ok) {
    res.setHeader('Retry-After', '60')
    res.status(rate.status).json({ ok: false, error: rate.error })
    return
  }

  res.status(200).json(getHostInfo())
}
