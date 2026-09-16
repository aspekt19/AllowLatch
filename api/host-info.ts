import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getHostInfo } from './host-info-data.js'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.status(200).json(getHostInfo())
}
