/**
 * Gate-baked AgentKit spender.
 *
 * Create a new financial agent with AllowLatch already in the signing path:
 * no policy → no spend; other (non-spend) work is unconstrained by this module.
 *
 *   const agent = await createGatedAgentKit({ gate: { kind: 'http', baseUrl: 'http://127.0.0.1:8787' } })
 *   await agent.transfer({ toAddress, amountUsd: 5 }) // throws until policy is applied
 */
import { SpendIntentSchema, type SpendIntent } from '../policy/schema.js'
import type { AllowReceipt } from '../billing/receipt.js'
import { assertSpend } from './assert-spend.js'
import { PlatformClient } from '@openserv-labs/client'

export type GatedGateConfig =
  | {
      kind: 'http'
      baseUrl: string
      token?: string
    }
  | {
      kind: 'openserv'
      triggerUrl?: string
      workflowId?: number
      /** x402 payer — usually the agent's OpenServ wallet key */
      walletPrivateKey?: string
      /**
       * true  → money moves on AllowLatch host (CDP there) via execute_gated_transfer
       * false → only assertSpend; you sign elsewhere after receipt (default)
       */
      executeOnHost?: boolean
    }

export type GatedAgentKit = {
  policyId: string
  gate: GatedGateConfig
  /** Short instruction to paste into the agent system prompt / skill. */
  systemPrompt: string
  /** Whether a MandatePolicy is already on the gate (HTTP only; OpenServ returns null). */
  hasPolicy(): Promise<boolean | null>
  /** Apply MandatePolicy JSON (HTTP gate). For OpenServ use paywall / payWorkflow apply_policy. */
  applyPolicy(policy: unknown, ownerId?: string): Promise<void>
  /**
   * Propose a spend. Always hits AllowLatch first.
   * No policy / DENY / ESCALATE (without humanApproved) → throws; does not sign.
   */
  transfer(args: {
    toAddress: string
    amountUsd: number
    symbol?: string
    reason?: string
    humanApproved?: boolean
    requestId?: string
  }): Promise<GatedSpendResult>
  /** Same gate path for swap / x402_pay intents (host may evaluate-only for swaps). */
  spend(intent: SpendIntent, opts?: { humanApproved?: boolean }): Promise<GatedSpendResult>
}

export type GatedSpendResult = {
  decision: 'allow' | 'deny' | 'escalate'
  executed: boolean
  message: string
  receipt: AllowReceipt | null
  txHash?: string
  walletAddress?: string
  raw: unknown
}

const SYSTEM_PROMPT = `You are an AgentKit agent with AllowLatch baked in.
- Non-spend tasks: do them normally.
- Any transfer / swap / x402 payment: you MUST go through AllowLatch (gated transfer). Never call raw wallet sign / CDP transfer yourself.
- If no spending policy is set yet, refuse to spend and ask the owner to apply a mandate (AllowLatch UI, apply_policy, or POST /v1/policies).
- On DENY: stop. On ESCALATE: ask the human. On ALLOW: only proceed with a valid allow-receipt.`

function httpHeaders(gate: Extract<GatedGateConfig, { kind: 'http' }>): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = gate.token ?? process.env.ALLOWLATCH_HTTP_TOKEN?.trim()
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function httpJson(
  gate: Extract<GatedGateConfig, { kind: 'http' }>,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const base = gate.baseUrl.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...httpHeaders(gate), ...(init?.headers as Record<string, string> | undefined) },
    })
  } catch (err) {
    throw new Error(
      `AllowLatch DENY (fail-closed): gate unreachable — ${err instanceof Error ? err.message : String(err)}`
    )
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errText =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : JSON.stringify(body)
    if (/unknown policyid/i.test(errText)) {
      throw new Error(
        'No spending policy yet — apply a mandate first (agent.applyPolicy / AllowLatch UI). Non-spend tasks can continue.'
      )
    }
    throw new Error(`AllowLatch DENY (fail-closed): HTTP ${res.status}: ${errText}`)
  }
  return body
}

async function spendViaHttp(
  gate: Extract<GatedGateConfig, { kind: 'http' }>,
  policyId: string,
  intent: SpendIntent,
  humanApproved?: boolean
): Promise<GatedSpendResult> {
  const evalBody = (await httpJson(gate, '/v1/evaluate', {
    method: 'POST',
    body: JSON.stringify({ policyId, intent }),
  })) as {
    decision?: string
    reasons?: string[]
    receipt?: AllowReceipt | null
  }

  const decision = String(evalBody.decision ?? 'deny').toLowerCase() as GatedSpendResult['decision']
  if (decision === 'deny') {
    throw new Error(`AllowLatch DENY: ${(evalBody.reasons ?? []).join('; ') || 'blocked'}`)
  }
  if (decision === 'escalate' && !humanApproved) {
    throw new Error(
      `AllowLatch ESCALATE: ask the human, then retry with humanApproved=true. ${(evalBody.reasons ?? []).join('; ')}`
    )
  }
  if (decision !== 'allow' && !(decision === 'escalate' && humanApproved)) {
    throw new Error(`AllowLatch ${decision}: refuse to sign`)
  }

  const exec = (await httpJson(gate, '/v1/execute', {
    method: 'POST',
    body: JSON.stringify({
      policyId,
      intent,
      humanApproved,
      receipt: evalBody.receipt ?? undefined,
      requestId: intent.requestId,
    }),
  })) as {
    executed?: boolean
    message?: string
    txHash?: string
    walletAddress?: string
    evaluation?: { decision?: string }
    receiptConsumed?: boolean
  }

  return {
    decision: (exec.evaluation?.decision as GatedSpendResult['decision']) || 'allow',
    executed: !!exec.executed,
    message: exec.message ?? (exec.executed ? 'executed' : 'not executed'),
    receipt: evalBody.receipt ?? null,
    txHash: exec.txHash,
    walletAddress: exec.walletAddress,
    raw: exec,
  }
}

async function spendViaOpenServ(
  gate: Extract<GatedGateConfig, { kind: 'openserv' }>,
  policyId: string,
  intent: SpendIntent,
  humanApproved?: boolean
): Promise<GatedSpendResult> {
  const asserted = await assertSpend({
    intent,
    policyId,
    triggerUrl: gate.triggerUrl,
    workflowId: gate.workflowId,
    walletPrivateKey: gate.walletPrivateKey,
    requireReceipt: true,
  })

  if (!gate.executeOnHost) {
    return {
      decision: 'allow',
      executed: false,
      message:
        'ALLOW + receipt verified. Sign externally only with this receipt, or set executeOnHost:true.',
      receipt: asserted.receipt,
      raw: asserted.raw,
    }
  }

  const client = new PlatformClient()
  const privateKey = gate.walletPrivateKey ?? process.env.WALLET_PRIVATE_KEY
  const payOpts = privateKey?.trim() ? { privateKey: privateKey.trim() } : {}
  const prompt = [
    `execute_gated_transfer for policyId=${policyId}`,
    humanApproved ? 'humanApproved=true' : '',
    'Intent JSON:',
    JSON.stringify(intent),
    'Allow-receipt JSON:',
    JSON.stringify(asserted.receipt),
  ]
    .filter(Boolean)
    .join('\n')

  let raw: unknown
  if (gate.workflowId) {
    raw = await client.payments.payWorkflow({
      workflowId: gate.workflowId,
      input: { prompt },
      ...payOpts,
    })
  } else if (gate.triggerUrl) {
    raw = await client.payments.payWorkflow({
      triggerUrl: gate.triggerUrl,
      input: { prompt },
      ...payOpts,
    })
  } else {
    throw new Error('openserv gate requires triggerUrl or workflowId')
  }

  const paid = raw as { response?: unknown }
  const payload = paid.response ?? raw
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  let parsed: Record<string, unknown> = {}
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    parsed = { raw: text }
  }

  return {
    decision: 'allow',
    executed: Boolean(parsed.executed),
    message: String(parsed.message ?? text),
    receipt: asserted.receipt,
    txHash: typeof parsed.txHash === 'string' ? parsed.txHash : undefined,
    walletAddress: typeof parsed.walletAddress === 'string' ? parsed.walletAddress : undefined,
    raw: parsed,
  }
}

/**
 * Factory: new AgentKit-oriented spender with AllowLatch already wired.
 * Spends never skip the gate. Apply a policy when the owner is ready.
 */
export async function createGatedAgentKit(args?: {
  policyId?: string
  gate?: GatedGateConfig
}): Promise<GatedAgentKit> {
  const policyId = args?.policyId ?? 'default'
  const gate: GatedGateConfig =
    args?.gate ??
    (process.env.ALLOWLATCH_TRIGGER_URL?.trim() || process.env.ALLOWLATCH_WORKFLOW_ID?.trim()
      ? {
          kind: 'openserv',
          triggerUrl: process.env.ALLOWLATCH_TRIGGER_URL?.trim(),
          workflowId: process.env.ALLOWLATCH_WORKFLOW_ID
            ? Number(process.env.ALLOWLATCH_WORKFLOW_ID)
            : undefined,
          walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
          executeOnHost: process.env.ALLOWLATCH_EXECUTE_ON_HOST === '1',
        }
      : {
          kind: 'http',
          baseUrl: process.env.ALLOWLATCH_HTTP_URL?.trim() || 'http://127.0.0.1:8787',
        })

  const agent: GatedAgentKit = {
    policyId,
    gate,
    systemPrompt: SYSTEM_PROMPT,

    async hasPolicy() {
      if (gate.kind !== 'http') return null
      try {
        const body = (await httpJson(gate, `/v1/policies/${encodeURIComponent(policyId)}`)) as {
          policy?: { name?: string } | null
        }
        return Boolean(body.policy?.name)
      } catch {
        return false
      }
    },

    async applyPolicy(policy, ownerId) {
      if (gate.kind !== 'http') {
        throw new Error(
          'applyPolicy() is for HTTP gate. On OpenServ: paywall / payWorkflow with apply_policy + MandatePolicy JSON.'
        )
      }
      await httpJson(gate, `/v1/policies/${encodeURIComponent(policyId)}`, {
        method: 'POST',
        body: JSON.stringify({ policy, ownerId }),
      })
    },

    async transfer(input) {
      const intent = SpendIntentSchema.parse({
        action: 'transfer',
        amountUsd: input.amountUsd,
        toAddress: input.toAddress,
        symbol: input.symbol ?? 'USDC',
        reason: input.reason ?? 'gated-agentkit transfer',
        requestId: input.requestId,
      })
      return agent.spend(intent, { humanApproved: input.humanApproved })
    },

    async spend(rawIntent, opts) {
      const intent = SpendIntentSchema.parse(rawIntent)
      if (gate.kind === 'http') {
        return spendViaHttp(gate, policyId, intent, opts?.humanApproved)
      }
      return spendViaOpenServ(gate, policyId, intent, opts?.humanApproved)
    },
  }

  return agent
}
