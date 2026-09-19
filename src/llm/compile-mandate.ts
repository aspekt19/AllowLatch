/**
 * Policy Copilot — draft / revise spending mandates via SERV Reasoning.
 *
 * SERV does judgment (conflicts, assumptions, questions).
 * The gate in engine.ts still owns allow/deny/escalate.
 */
import {
  MandatePolicySchema,
  PolicyDraftSchema,
  type MandatePolicy,
  type PolicyDraft,
} from '../policy/schema.js'
import {
  SERV_DEFAULT_MODEL,
  servStructured,
  type ServMeta,
} from './serv-reasoning.js'

export const DRAFT_PROMPT_VERSION = 'allowlatch-draft-v1'
export const COMPILER_PROMPT_VERSION = 'allowlatch-compile-v2'

/** Uniswap Universal Router on Base — only when mandate mentions Uniswap. */
export const BASE_UNISWAP_UNIVERSAL_ROUTER =
  '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'

export function resolveCompileModel(): string {
  if (process.env.SERV_COMPILE_MODEL) return process.env.SERV_COMPILE_MODEL
  const base = process.env.SERV_MODEL ?? SERV_DEFAULT_MODEL
  if (base.includes('-serv-')) return base
  return `${base}-serv-multipath`
}

const POLICY_RULES = `MandatePolicy constraints:
- version "1.0", chain "base" or "base-sepolia", currency "USDC"
- ownerId / agentId optional identity strings when known
- Do not invent tickers or addresses. Symbols only if clearly allowed (USDC, ETH, WETH, or named). Addresses only if named, or Uniswap Universal Router on Base when Uniswap is mentioned: ${BASE_UNISWAP_UNIVERSAL_ROUTER}
- deniedSymbols: memes / explicitly banned (e.g. PEPE) when forbidden
- allowedAddresses / allowedContracts / allowedTokenAddresses / allowedFunctionSelectors non-empty ⇒ gate requires matching fields — only if mandate implies allowlist
- Prefer token contract addresses over symbols when the mandate names a specific token; USDC on Base is 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
- risk.maxSlippageBps when mandate mentions slippage; risk.emergencyStop only if owner says pause/stop all spends
- agentWalletBudgetUsd is a HARD lifetime ledger ceiling (not soft metadata)
- requireHumanConfirmAboveUsd ≤ maxPerOrderUsd; if "ask above $X", use X; else slightly below maxPerOrderUsd
- Defaults if omitted: agentWalletBudgetUsd 200, maxNotionalUsdPerDay 40, maxPerOrderUsd 10, maxTransactionsPerHour 20; actions true unless forbidden
- Prefer tighter limits when ambiguous; leave arrays empty rather than guessing`

export const DRAFT_SYSTEM_PROMPT = `You are AllowLatch Policy Copilot for AI agent wallets on Base (USDC).

Objective: turn a human spending mandate into a PolicyDraft the owner can review before the deterministic gate enforces it. You do NOT approve spends.

Output:
- policy: strict MandatePolicy
- conflicts: contradictions or tensions in the mandate (empty if none)
- assumptions: defaults / interpretations you applied (be explicit)
- questions: what the owner should clarify before trusting the policy (empty if clear enough)
- readyToApply: true only if questions is empty and no blocking conflict remains; warnings in conflicts can still exist if you chose a conservative resolution
- summary: 1–3 sentences for the owner

Decision priorities: safety > fidelity to stated numbers > conservatism on gaps > clarity.

${POLICY_RULES}`

export const COMPILE_SYSTEM_PROMPT = `You are AllowLatch's mandate compiler for AI agent wallets on Base.

Objective: turn a human spending mandate into a strict MandatePolicy JSON that a deterministic gate will enforce. You do not approve spends; you only compile rules.

Decision priorities (highest first):
1. Safety — prefer tighter limits when the mandate is ambiguous.
2. Fidelity — encode every explicit number, symbol, address, and action the human stated.
3. Conservatism — when a limit is missing, use safe defaults (never invent generous caps).
4. Clarity — short policy name; no commentary outside the schema.

${POLICY_RULES}

Abstain from narrative explanations — output only fields that fit MandatePolicy.`

const DRAFT_SHADOW =
  'Valid PolicyDraft: MandatePolicy with chain=base currency=USDC; list real conflicts/assumptions/questions; readyToApply false if questions remain; no invented tickers/addresses.'

const COMPILE_SHADOW =
  'Valid MandatePolicy only: chain=base, currency=USDC, version=1.0; numeric caps conservative; no invented tickers or addresses; requireHumanConfirmAboveUsd ≤ maxPerOrderUsd.'

function normalizeDraft(raw: PolicyDraft): PolicyDraft {
  const policy = MandatePolicySchema.parse(raw.policy)
  const questions = raw.questions ?? []
  const readyToApply = questions.length === 0 ? raw.readyToApply : false
  return PolicyDraftSchema.parse({
    ...raw,
    policy,
    readyToApply,
  })
}

/** Full Policy Copilot draft (preferred entry for new UX). */
export async function draftPolicyWithServ(
  mandateText: string
): Promise<{ draft: PolicyDraft; meta: ServMeta }> {
  const text = mandateText.trim()
  if (text.length < 10) throw new Error('mandateText too short')

  const { data, meta } = await servStructured({
    system: DRAFT_SYSTEM_PROMPT,
    user: `Draft a spending policy for review.

Mandate:
"""
${text}
"""`,
    schema: PolicyDraftSchema,
    schemaName: 'policy_draft',
    model: resolveCompileModel(),
    reasoningEffort: 'medium',
    promptVersion: DRAFT_PROMPT_VERSION,
    servTools: {
      promptGuard: true,
      shadowAgent: { hint: DRAFT_SHADOW, maxIterations: 3 },
    },
  })

  return { draft: normalizeDraft(data), meta }
}

/** Revise an existing policy using owner feedback (NL). */
export async function revisePolicyWithServ(params: {
  currentPolicy: MandatePolicy
  revisionText: string
}): Promise<{ draft: PolicyDraft; meta: ServMeta }> {
  const revision = params.revisionText.trim()
  if (revision.length < 3) throw new Error('revisionText too short')

  const { data, meta } = await servStructured({
    system: DRAFT_SYSTEM_PROMPT,
    user: `Revise the current MandatePolicy using the owner's change request. Preserve unchanged rules. Re-check conflicts, assumptions, questions.

Current policy JSON:
${JSON.stringify(params.currentPolicy, null, 2)}

Owner revision:
"""
${revision}
"""`,
    schema: PolicyDraftSchema,
    schemaName: 'policy_draft',
    model: resolveCompileModel(),
    reasoningEffort: 'medium',
    promptVersion: DRAFT_PROMPT_VERSION,
    servTools: {
      promptGuard: true,
      shadowAgent: { hint: DRAFT_SHADOW, maxIterations: 3 },
    },
  })

  return { draft: normalizeDraft(data), meta }
}

/** Back-compat: policy only (battle / older scripts). */
export async function compileMandateWithServ(
  mandateText: string
): Promise<{ policy: MandatePolicy; meta: ServMeta }> {
  const text = mandateText.trim()
  if (text.length < 10) throw new Error('mandateText too short')

  const { data, meta } = await servStructured({
    system: COMPILE_SYSTEM_PROMPT,
    user: `Compile this human spending mandate into a MandatePolicy object.

Mandate:
"""
${text}
"""`,
    schema: MandatePolicySchema,
    schemaName: 'mandate_policy',
    model: resolveCompileModel(),
    reasoningEffort: 'medium',
    promptVersion: COMPILER_PROMPT_VERSION,
    servTools: {
      promptGuard: true,
      shadowAgent: { hint: COMPILE_SHADOW, maxIterations: 3 },
    },
  })

  return { policy: MandatePolicySchema.parse(data), meta }
}
