import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEMO_POLICY, MandatePolicySchema, type MandatePolicy, type SpendLedger } from '../policy/schema.js'
import { freshLedger } from '../policy/engine.js'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const POLICIES_PATH = path.join(DATA_DIR, 'policies.json')
const LEDGERS_PATH = path.join(DATA_DIR, 'ledgers.json')

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true })
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function loadPolicies(): Promise<Record<string, MandatePolicy>> {
  await ensureDataDir()
  const data = await readJson<Record<string, unknown>>(POLICIES_PATH, {})
  const out: Record<string, MandatePolicy> = {}
  for (const [id, value] of Object.entries(data)) {
    const parsed = MandatePolicySchema.safeParse(value)
    if (parsed.success) out[id] = parsed.data
  }
  if (!out.default) out.default = DEMO_POLICY
  return out
}

export async function savePolicies(policies: Record<string, MandatePolicy>): Promise<void> {
  await ensureDataDir()
  await writeFile(POLICIES_PATH, JSON.stringify(policies, null, 2))
}

export async function loadLedgers(): Promise<Record<string, SpendLedger>> {
  await ensureDataDir()
  const data = await readJson<Record<string, SpendLedger>>(LEDGERS_PATH, {})
  if (!data.default) data.default = freshLedger()
  return data
}

export async function saveLedgers(ledgers: Record<string, SpendLedger>): Promise<void> {
  await ensureDataDir()
  await writeFile(LEDGERS_PATH, JSON.stringify(ledgers, null, 2))
}

/** Tiny facade used by the agent. */
export class PolicyStore {
  private policies: Record<string, MandatePolicy> = { default: DEMO_POLICY }
  private ledgers: Record<string, SpendLedger> = { default: freshLedger() }
  private ready = false

  async init() {
    this.policies = await loadPolicies()
    this.ledgers = await loadLedgers()
    this.ready = true
  }

  private assertReady() {
    if (!this.ready) throw new Error('PolicyStore not initialized')
  }

  getPolicy(policyId: string): MandatePolicy {
    this.assertReady()
    const p = this.policies[policyId]
    if (!p) throw new Error(`Unknown policyId "${policyId}". Compile a mandate first.`)
    return p
  }

  async setPolicy(policyId: string, policy: MandatePolicy) {
    this.assertReady()
    this.policies[policyId] = policy
    this.ledgers[policyId] = freshLedger()
    await savePolicies(this.policies)
    await saveLedgers(this.ledgers)
  }

  getLedger(policyId: string): SpendLedger {
    this.assertReady()
    if (!this.ledgers[policyId]) this.ledgers[policyId] = freshLedger()
    return this.ledgers[policyId]
  }

  async setLedger(policyId: string, ledger: SpendLedger) {
    this.assertReady()
    this.ledgers[policyId] = ledger
    await saveLedgers(this.ledgers)
  }

  async resetLedger(policyId: string) {
    await this.setLedger(policyId, freshLedger())
  }
}
