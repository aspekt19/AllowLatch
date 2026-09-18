import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHostInfo } from './host-info-data.js'
import { allowedCopilotOrigins } from './abuse-guard.js'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  if (origin && allowedCopilotOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.status(200).json(getHostInfo())
}
