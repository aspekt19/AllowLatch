/**
 * Factory for PolicyStoreApi. Today: SQLite only.
 * Future: ALLOWLATCH_STORE=postgres|turso without changing agent/HTTP call sites.
 */
import type { PolicyStoreApi } from './types.js'
import { PolicyStore } from './fs-store.js'

export type StoreBackend = 'sqlite'

export function resolveStoreBackend(): StoreBackend {
  const raw = (process.env.ALLOWLATCH_STORE || 'sqlite').trim().toLowerCase()
  if (raw === 'sqlite') return 'sqlite'
  throw new Error(
    `Unsupported ALLOWLATCH_STORE="${raw}". Only "sqlite" is implemented; see docs/ARCHITECTURE.md.`
  )
}

export function createStore(): PolicyStoreApi {
  resolveStoreBackend()
  return new PolicyStore()
}
