/** Env-only helpers — safe to import from Vite/UI paths (no @libsql/client). */
export function tursoConfigured(): boolean {
  return Boolean(
    process.env.ALLOWLATCH_TURSO_DATABASE_URL?.trim() ||
      process.env.TURSO_DATABASE_URL?.trim()
  )
}

export function tursoDatabaseUrl(): string {
  return (
    process.env.ALLOWLATCH_TURSO_DATABASE_URL?.trim() ||
    process.env.TURSO_DATABASE_URL?.trim() ||
    ''
  )
}

export function tursoAuthToken(): string | undefined {
  return (
    process.env.ALLOWLATCH_TURSO_AUTH_TOKEN?.trim() ||
    process.env.TURSO_AUTH_TOKEN?.trim() ||
    undefined
  )
}
