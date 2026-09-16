/**
 * Explain a deterministic gate decision in plain language (SERV).
 * Does not change allow/deny — only clarifies and suggests mandate edits.
 */
import {
  DecisionExplanationSchema,
  EvaluationResultSchema,
  MandatePolicySchema,
  type DecisionExplanation,
  type EvaluationResult,
  type MandatePolicy,
} from '../policy/schema.js'
import {
  SERV_DEFAULT_MODEL,
  servStructured,
  type ServMeta,
} from './serv-reasoning.js'

export const EXPLAIN_PROMPT_VERSION = 'spendgate-explain-v1'

function explainModel(): string {
  if (process.env.SERV_EXPLAIN_MODEL) return process.env.SERV_EXPLAIN_MODEL
  if (process.env.SERV_COMPILE_MODEL) return process.env.SERV_COMPILE_MODEL
  const base = process.env.SERV_MODEL ?? SERV_DEFAULT_MODEL
  if (base.includes('-serv-')) return base
  return `${base}-serv-multipath`
}

const EXPLAIN_SYSTEM = `You are SpendGate Policy Copilot explaining a gate decision.

The allow/deny/escalate verdict was produced by deterministic code — you must NOT contradict it or invent a different decision.

Objective:
- Explain why this spend hit that verdict, in clear owner language
- Tie reasons to specific policy fields when possible
- Suggest concrete mandate wording changes if the owner wants a different future outcome
- Set revisable=true when a policy edit could make a similar spend allow (or escalate less often); false when the intent itself is impossible under sane rules

Be concise. No marketing fluff.`

export async function explainDecisionWithServ(params: {
  policy: MandatePolicy
  evaluation: EvaluationResult
}): Promise<{ explanation: DecisionExplanation; meta: ServMeta }> {
  MandatePolicySchema.parse(params.policy)
  EvaluationResultSchema.parse(params.evaluation)

  const { data, meta } = await servStructured({
    system: EXPLAIN_SYSTEM,
    user: `Explain this SpendGate gate result for the wallet owner.

Policy JSON:
${JSON.stringify(params.policy, null, 2)}

Evaluation JSON:
${JSON.stringify(params.evaluation, null, 2)}`,
    schema: DecisionExplanationSchema,
    schemaName: 'decision_explanation',
    model: explainModel(),
    reasoningEffort: 'low',
    promptVersion: EXPLAIN_PROMPT_VERSION,
    servTools: {
      promptGuard: true,
      shadowAgent: {
        hint: 'Must respect the given decision; suggest mandate edits only; no invented verdict.',
        maxIterations: 2,
      },
    },
  })

  return {
    explanation: DecisionExplanationSchema.parse(data),
    meta,
  }
}
