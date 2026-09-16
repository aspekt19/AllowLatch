/**
 * Owner-side Policy Copilot.
 *
 * Runs on the *owner's* agent with the owner's SERV_API_KEY.
 * SpendGate host never stores or receives that key.
 *
 * Flow:
 *   1) draft / revise / explain here (SERV)
 *   2) apply_policy + evaluate_intent / execute on the keyless gate host (x402)
 */
import { draftPolicyWithServ, revisePolicyWithServ } from '../llm/compile-mandate.js'
import { explainDecisionWithServ } from '../llm/explain-decision.js'
import type {
  DecisionExplanation,
  EvaluationResult,
  MandatePolicy,
  PolicyDraft,
  SpendIntent,
} from '../policy/schema.js'
import type { ServMeta } from '../llm/serv-reasoning.js'

export type OwnerDraftResult = {
  draft: PolicyDraft
  meta: ServMeta
}

export type OwnerExplainResult = {
  explanation: DecisionExplanation
  meta: ServMeta
}

/** Draft a MandatePolicy from NL using the owner's SERV account. */
export async function ownerDraftPolicy(mandateText: string): Promise<OwnerDraftResult> {
  return draftPolicyWithServ(mandateText)
}

/** Revise a policy from owner feedback using the owner's SERV account. */
export async function ownerRevisePolicy(args: {
  currentPolicy: MandatePolicy
  revisionText: string
}): Promise<OwnerDraftResult> {
  return revisePolicyWithServ(args)
}

/** Explain a gate verdict using the owner's SERV account (does not change the verdict). */
export async function ownerExplainDecision(args: {
  policy: MandatePolicy
  evaluation: EvaluationResult
}): Promise<OwnerExplainResult> {
  return explainDecisionWithServ(args)
}

/** Prompt for the keyless SpendGate gate: persist an accepted policy. */
export function gateApplyPrompt(args: {
  policyId?: string
  policy: MandatePolicy
}): string {
  const policyId = args.policyId ?? 'default'
  return [
    `apply_policy for policyId=${policyId}`,
    'Store this MandatePolicy JSON exactly:',
    JSON.stringify(args.policy),
  ].join('\n')
}

/** Prompt for the keyless gate: evaluate a spend (no tx). */
export function gateEvaluatePrompt(args: {
  policyId?: string
  intent: SpendIntent
}): string {
  const policyId = args.policyId ?? 'default'
  return [
    `evaluate_intent for policyId=${policyId}`,
    'Intent JSON:',
    JSON.stringify(args.intent),
  ].join('\n')
}

/** Prompt for the keyless gate: execute only after ALLOW (or escalate + humanApproved). */
export function gateExecutePrompt(args: {
  policyId?: string
  intent: SpendIntent
  humanApproved?: boolean
}): string {
  const policyId = args.policyId ?? 'default'
  const approved = args.humanApproved === true
  return [
    `execute_gated_transfer for policyId=${policyId} humanApproved=${approved}`,
    'Intent JSON:',
    JSON.stringify(args.intent),
  ].join('\n')
}
