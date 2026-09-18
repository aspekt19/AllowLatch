/**
 * Shared helpers for the local HTTP gate (CORS + body size + loopback checks).
 */
export const GATE_MAX_BODY_BYTES = 256_000

const DEFAULT_CORS = [
  'https://allowlatch.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

export function allowedCorsOrigins(): string[] {
  const extra = (process.env.ALLOWLATCH_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set([...DEFAULT_CORS, ...extra])]
}

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
