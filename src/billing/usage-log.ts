/**
 * Append-only usage log for monetization / operator analytics.
 * Payer wallet is settled by OpenServ x402; we record capability traffic locally.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const USAGE_PATH = path.join(DATA_DIR, 'usage.jsonl')

export type UsageEvent = {
  at: string
  capability: string
  policyId?: string
  decision?: string
  payerHint?: string
  meta?: Record<string, unknown>
}

export async function logUsage(event: UsageEvent): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true })
    await appendFile(USAGE_PATH, `${JSON.stringify(event)}\n`, 'utf8')
  } catch (err) {
    console.error('[usage-log]', err instanceof Error ? err.message : err)
  }
}
