/**
 * Shared abuse guards for demo Copilot HTTP (Vite + Vercel).
 * Not a substitute for edge WAF — best-effort per-instance limits.
 */
const MAX_BODY_CHARS = 48_000
const MAX_MANDATE_CHARS = 8_000
const RATE_WINDOW_MS = 60_000
const RATE_MAX = Number(process.env.ALLOWLATCH_COPILOT_RATE_MAX || 20)

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

const DEFAULT_ORIGINS = [
  'https://allowlatch.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

export function allowedCopilotOrigins(): string[] {
  const extra = (process.env.ALLOWLATCH_COPILOT_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...DEFAULT_ORIGINS, ...extra]
}

export function clientIp(req: { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const xf = req.headers?.['x-forwarded-for']
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0]!.trim()
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0]!.trim()
  return req.socket?.remoteAddress || 'unknown'
}

export function checkOrigin(origin: string | undefined): { ok: true } | { ok: false; status: number; error: string } {
  // Same-origin / non-browser clients often omit Origin.
  if (!origin) return { ok: true }
  if (allowedCopilotOrigins().includes(origin)) return { ok: true }
  return { ok: false, status: 403, error: 'Origin not allowed' }
}

export function checkRateLimit(key: string): { ok: true } | { ok: false; status: number; error: string } {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS }
    buckets.set(key, b)
  }
  b.count += 1
  if (b.count > RATE_MAX) {
    return { ok: false, status: 429, error: `Rate limit exceeded (${RATE_MAX}/min). Try again shortly.` }
  }
  return { ok: true }
}

export function checkBodySize(body: unknown): { ok: true } | { ok: false; status: number; error: string } {
  let size = 0
  try {
    size = JSON.stringify(body ?? {}).length
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' }
  }
  if (size > MAX_BODY_CHARS) {
    return { ok: false, status: 413, error: `Body too large (max ${MAX_BODY_CHARS} chars)` }
  }
  return { ok: true }
}

export function clampMandateText(text: string): string {
  if (text.length <= MAX_MANDATE_CHARS) return text
  return text.slice(0, MAX_MANDATE_CHARS)
}

export const COPILOT_LIMITS = { MAX_BODY_CHARS, MAX_MANDATE_CHARS, RATE_WINDOW_MS, RATE_MAX }
