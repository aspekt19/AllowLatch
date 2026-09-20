/**
 * Server-side bridge: website → OpenServ x402 AllowLatch Gate.
 * Uses operator/demo payer key (WALLET_PRIVATE_KEY) — never expose to the browser.
 */
import { PlatformClient } from '@openserv-labs/client'
import { MandatePolicySchema, SpendIntentSchema, type MandatePolicy, type SpendIntent } from '../policy/schema.js'

function triggerUrl(): string {
  const u =
    process.env.ALLOWLATCH_TRIGGER_URL?.trim() ||
    process.env.ALLOWLATCH_X402_TRIGGER_URL?.trim() ||
    ''
  if (!u) {
    throw new Error('ALLOWLATCH_TRIGGER_URL not configured on this deployment')
  }
  return u
}

function payerKey(): string {
  const k =
    process.env.ALLOWLATCH_X402_PAYER_KEY?.trim() ||
    process.env.WALLET_PRIVATE_KEY?.trim() ||
    ''
  if (!k) {
    throw new Error('WALLET_PRIVATE_KEY (x402 payer) not configured on this deployment')
  }
  return k
}

function extractJson(raw: unknown): Record<string, unknown> {
  const paid = raw as { response?: unknown }
  const payload = paid.response ?? raw
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('Gate response was not JSON')
  }
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
}

async function payPrompt(prompt: string): Promise<Record<string, unknown>> {
  const client = new PlatformClient()
  const raw = await client.payments.payWorkflow({
    triggerUrl: triggerUrl(),
    input: { prompt },
    privateKey: payerKey(),
  })
  return extractJson(raw)
}

export async function hostApplyPolicy(args: {
  policyId: string
  ownerId: string
  policy: MandatePolicy
  ownerToken?: string
}): Promise<Record<string, unknown>> {
  const policy = MandatePolicySchema.parse({
    ...args.policy,
    ownerId: args.ownerId,
  })
  const prompt = [
    `apply_policy for policyId=${args.policyId}`,
    `ownerId=${args.ownerId}`,
    args.ownerToken ? `ownerToken=${args.ownerToken}` : '',
    'Store this MandatePolicy JSON exactly and return ownerToken if minted:',
    JSON.stringify(policy),
  ]
    .filter(Boolean)
    .join('\n')
  return payPrompt(prompt)
}

export async function hostEvaluateIntent(args: {
  policyId: string
  intent: SpendIntent
}): Promise<Record<string, unknown>> {
  const intent = SpendIntentSchema.parse(args.intent)
  const prompt = [
    `evaluate_intent for policyId=${args.policyId}`,
    'Return the JSON evaluation. If ALLOW, include allow-receipt.',
    'Intent JSON:',
    JSON.stringify(intent),
  ].join('\n')
  return payPrompt(prompt)
}

export function gateProxyConfigured(): boolean {
  try {
    triggerUrl()
    payerKey()
    return true
  } catch {
    return false
  }
}
