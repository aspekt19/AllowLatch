/**
 * Gate-baked AgentKit spender.
 *
 * Preferred (always-on Vercel site gate):
 *   const agent = await createGatedAgentKit({
 *     gate: {
 *       kind: 'site',
 *       gateUrl: 'https://allowlatch.vercel.app/api/gate',
 *       sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
 *     },
 *     walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // x402 payer
 *   })
 *   await agent.transfer({ toAddress, amountUsd: 5 }) // throws until policy is applied
 *
 * Local HTTP / OpenServ are for offline dev or fallback only.
 */
import { SpendIntentSchema, type SpendIntent } from '../policy/schema.js'
import type { AllowReceipt } from '../billing/receipt.js'
import { assertSpend } from './assert-spend.js'
import {
  feeAdviceForSpend,
  formatProductionShapeHint,
  recommendProductionShape,
  type ProductionShapeReport,
} from './production-shape.js'
import { PlatformClient } from '@openserv-labs/client'
import { formatUsdcAtomic, usdcAtomicFromUsd } from '../policy/amount-bind.js'
import { CHAIN_IDS, USDC_BY_CHAIN } from '../policy/engine.js'

export type GatedGateConfig =
  | {
      kind: 'http'
      baseUrl: string
      token?: string
      /** Owner credential — required for escalate + humanApproved on /v1/execute. */
      ownerToken?: string
    }
    | {
      /** Always-on Vercel /api/gate via assertSpend (x402). Prefer over chat-only prompts. */
      kind: 'site'
      gateUrl?: string
      sessionSeal?: string
      walletPrivateKey?: string
      /** Prepaid evaluate credits from buy_pack — prefer for micro transfers vs $0.025/call. */
      packKey?: string
      policyId?: string
      /**
       * Owner credential from Go live — required for escalate + humanApproved on site evaluate.
       * Never paste into public Connect packs; keep on the owner side.
       */
      ownerToken?: string
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
  /** Env checklist: hybrid Spend Permissions, Turso, pack credits, coffee-money. */
  productionShape: ProductionShapeReport
  /** Whether a MandatePolicy is already on the gate (HTTP only; OpenServ returns null). */
  hasPolicy(): Promise<boolean | null>
  /** Apply MandatePolicy JSON (HTTP gate). For OpenServ use paywall / payWorkflow apply_policy. */
  applyPolicy(policy: unknown, ownerId?: string): Promise<void>
  /**
   * Propose a spend. Always hits AllowLatch first.
   * No policy / DENY / ESCALATE (without humanApproved) → throws; does not sign.
   * Reject / DENY never yields a receipt — do not sign.
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

const SYSTEM_PROMPT = `You are an AgentKit agent with AllowLatch on the spend path.
- Non-spend tasks: do them normally.
- Any transfer / swap / x402 payment: only via createGatedAgentKit.transfer / .spend. Never call a raw signer in parallel.
- ALLOW + single-use receipt → may sign that exact intent. DENY / reject / timeout → stop; no receipt, no signature.
- ESCALATE → ask the human (never set humanApproved yourself). Retry with humanApproved=true + ownerToken. Human reject → no receipt.
- After ALLOW the kit consumes the receipt jti before returning it for external sign (single-use).
- Prefer hybrid Coinbase Spend Permissions (on-chain daily cap). Middleware alone is not custody if a raw key remains.
- Micro transfers: use packKey / buy_pack (~$0.008) instead of paying $0.025 every evaluate.
- Hosted gate is SaaS authorization (operator trust), not a vault. Coffee-money balances until audit.`

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
      `AllowLatch ESCALATE: ask the human, then retry with humanApproved=true and ownerToken. ${(evalBody.reasons ?? []).join('; ')}`
    )
  }
  if (decision !== 'allow' && !(decision === 'escalate' && humanApproved)) {
    throw new Error(`AllowLatch ${decision}: refuse to sign`)
  }
  if (humanApproved && !gate.ownerToken && !process.env.ALLOWLATCH_OPERATOR_TOKEN?.trim()) {
    throw new Error(
      'AllowLatch ESCALATE: humanApproved requires gate.ownerToken (spender cannot self-approve)'
    )
  }

  const exec = (await httpJson(gate, '/v1/execute', {
    method: 'POST',
    body: JSON.stringify({
      policyId,
      intent,
      humanApproved,
      ownerToken: gate.ownerToken,
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

async function consumeSiteReceipt(args: {
  gateUrl: string
  policyId: string
  receipt: AllowReceipt
  intent: SpendIntent
}): Promise<void> {
  // consume is free — valid receipt is the credential (evaluate already paid).
  const res = await fetch(args.gateUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'consume',
      policyId: args.policyId,
      receipt: args.receipt,
      intent: args.intent,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `consume HTTP ${res.status}`)
  }
}

async function spendViaSite(
  gate: Extract<GatedGateConfig, { kind: 'site' }>,
  policyId: string,
  intent: SpendIntent,
  humanApproved?: boolean
): Promise<GatedSpendResult> {
  const packKey = gate.packKey ?? process.env.ALLOWLATCH_PACK_KEY?.trim()
  const fee = feeAdviceForSpend(intent.amountUsd, { hasPackKey: Boolean(packKey) })
  if (fee.preferPack) console.warn(`AllowLatch fee: ${fee.message}`)
  const ownerToken =
    gate.ownerToken?.trim() || process.env.ALLOWLATCH_OWNER_TOKEN?.trim() || undefined
  const gateUrl =
    gate.gateUrl?.trim() ||
    process.env.ALLOWLATCH_GATE_URL?.trim() ||
    'https://allowlatch.vercel.app/api/gate'
  const pid = gate.policyId ?? policyId

  const asserted = await assertSpend({
    intent,
    policyId: pid,
    gateUrl,
    sessionSeal: gate.sessionSeal,
    walletPrivateKey: gate.walletPrivateKey,
    packKey,
    requireReceipt: true,
    humanApproved,
    ownerToken,
  })
  if (asserted.sessionSeal) {
    gate.sessionSeal = asserted.sessionSeal
  }

  if (asserted.decision === 'escalate' && !humanApproved) {
    throw new Error(
      `AllowLatch ESCALATE: ask the human, then retry with humanApproved=true and ownerToken. ${JSON.stringify(asserted.evaluation).slice(0, 240)}`
    )
  }
  if (asserted.decision === 'escalate' && humanApproved && !ownerToken) {
    throw new Error(
      'AllowLatch ESCALATE: humanApproved requires gate.ownerToken (spender cannot self-approve)'
    )
  }
  if (asserted.decision !== 'allow' || !asserted.receipt) {
    throw new Error(`AllowLatch ${asserted.decision}: refuse to sign (no receipt)`)
  }

  // Claim single-use jti before returning receipt for external sign (fail closed on replay gaps).
  await consumeSiteReceipt({
    gateUrl,
    policyId: pid,
    receipt: asserted.receipt,
    intent,
  })

  return {
    decision: 'allow',
    executed: false,
    message:
      'ALLOW + receipt verified and jti consumed via site gate. Sign only this intent externally. Prefer hybrid Spend Permissions for on-chain daily caps. Middleware alone is not custody-grade if a raw signer remains.',
    receipt: asserted.receipt,
    raw: asserted.raw,
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
    humanApproved,
  })

  if (asserted.decision === 'escalate' && !humanApproved) {
    throw new Error(
      `AllowLatch ESCALATE: ask the human, then retry with humanApproved=true. ${JSON.stringify(asserted.evaluation).slice(0, 240)}`
    )
  }
  if (asserted.decision !== 'allow' || !asserted.receipt) {
    throw new Error(`AllowLatch ${asserted.decision}: refuse to sign (no receipt)`)
  }

  if (!gate.executeOnHost) {
    return {
      decision: 'allow',
      executed: false,
      message:
        'ALLOW + receipt verified. Sign externally only with this receipt, or set executeOnHost:true. Prefer createGatedAgentKit({ kind: "site" }) which also consumes jti.',
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
    (process.env.ALLOWLATCH_GATE_URL?.trim() || process.env.ALLOWLATCH_SESSION_SEAL?.trim()
      ? {
          kind: 'site',
          gateUrl: process.env.ALLOWLATCH_GATE_URL?.trim(),
          sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL?.trim(),
          walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
          packKey: process.env.ALLOWLATCH_PACK_KEY?.trim(),
          policyId,
        }
      : process.env.ALLOWLATCH_TRIGGER_URL?.trim() || process.env.ALLOWLATCH_WORKFLOW_ID?.trim()
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

  const productionShape = recommendProductionShape()
  if (!productionShape.productionPrerequisitesSatisfied) {
    console.warn(formatProductionShapeHint(productionShape))
  }

  const agent: GatedAgentKit = {
    policyId,
    gate,
    systemPrompt: SYSTEM_PROMPT,
    productionShape,

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
      const symbol = (input.symbol ?? 'USDC').toUpperCase()
      const chain = 'base' as const
      const intent = SpendIntentSchema.parse({
        action: 'transfer',
        amountUsd: input.amountUsd,
        toAddress: input.toAddress,
        symbol,
        tokenAddress:
          symbol === 'USDC' ? USDC_BY_CHAIN[chain] : undefined,
        tokenAmount:
          symbol === 'USDC'
            ? formatUsdcAtomic(usdcAtomicFromUsd(input.amountUsd))
            : undefined,
        functionSelector: symbol === 'USDC' ? '0xa9059cbb' : undefined,
        chainId: CHAIN_IDS[chain],
        networkId: chain,
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
      if (gate.kind === 'site') {
        return spendViaSite(gate, policyId, intent, opts?.humanApproved)
      }
      return spendViaOpenServ(gate, policyId, intent, opts?.humanApproved)
    },
  }

  return agent
}
