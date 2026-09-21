/**
 * Shared abuse / CORS helpers for demo Copilot (Vite + Vercel) and HTTP gate.
 * In-memory rate limits are best-effort per instance — not a WAF substitute.
 */

export const GATE_MAX_BODY_BYTES = 256_000
const MAX_BODY_CHARS = 48_000
const MAX_MANDATE_CHARS = 8_000
const RATE_WINDOW_MS = 60_000
const RATE_MAX_DEFAULT = Number(process.env.ALLOWLATCH_COPILOT_RATE_MAX || 20)

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

const DEFAULT_ORIGINS = [
  'https://allowlatch.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

export function allowedCorsOrigins(): string[] {
  const extra = (process.env.ALLOWLATCH_CORS_ORIGINS || process.env.ALLOWLATCH_COPILOT_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set([...DEFAULT_ORIGINS, ...extra])]
}

/** Alias used by Copilot handlers. */
export const allowedCopilotOrigins = allowedCorsOrigins

/** Returns Access-Control-Allow-Origin value, or null if Origin is present but not allowed. */
export function resolveCorsOrigin(requestOrigin: string | undefined | null): string | null {
  if (!requestOrigin) return allowedCorsOrigins()[0] ?? null
  const allowed = allowedCorsOrigins()
  if (allowed.includes(requestOrigin)) return requestOrigin
  return null
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === '127.0.0.1' || h === '::1' || h === 'localhost' || h === '0:0:0:0:0:0:0:1'
}

export function assertJsonBodySize(raw: string, max = GATE_MAX_BODY_BYTES): void {
  if (raw.length > max) {
    throw new Error(`Request body too large (max ${max} bytes)`)
  }
}

function firstHeader(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  const raw = headers?.[name]
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
  const hop = value.split(',')[0]?.trim()
  return hop || undefined
}

export function clientIp(req: {
  headers?: Record<string, unknown>
  socket?: { remoteAddress?: string }
}): string {
  // Vercel strips client spoofing on this header. x-forwarded-for's left hop is attacker-controlled.
  return (
    firstHeader(req.headers, 'x-vercel-forwarded-for') ||
    firstHeader(req.headers, 'x-real-ip') ||
    firstHeader(req.headers, 'x-forwarded-for') ||
    req.socket?.remoteAddress ||
    'unknown'
  )
}

export function checkOrigin(
  origin: string | undefined
): { ok: true } | { ok: false; status: number; error: string } {
  if (!origin) return { ok: true }
  if (allowedCopilotOrigins().includes(origin)) return { ok: true }
  return { ok: false, status: 403, error: 'Origin not allowed' }
}

export function checkRateLimit(
  key: string,
  maxPerWindow = RATE_MAX_DEFAULT
): { ok: true } | { ok: false; status: number; error: string } {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS }
    buckets.set(key, b)
  }
  b.count += 1
  if (b.count > maxPerWindow) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit exceeded (${maxPerWindow}/min). Try again shortly.`,
    }
  }
  return { ok: true }
}

export function checkBodySize(
  body: unknown
): { ok: true } | { ok: false; status: number; error: string } {
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

export const COPILOT_LIMITS = {
  MAX_BODY_CHARS,
  MAX_MANDATE_CHARS,
  RATE_WINDOW_MS,
  RATE_MAX: RATE_MAX_DEFAULT,
}
