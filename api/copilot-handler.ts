/**
 * Copilot HTTP handlers shared by Vite middleware and Vercel `/api/copilot`.
 * Host SERV_API_KEY only - never accept a caller key.
 */
import { draftPolicyWithServ, revisePolicyWithServ } from '../src/llm/compile-mandate.js'
import { explainDecisionWithServ } from '../src/llm/explain-decision.js'
import {
  EvaluationResultSchema,
  MandatePolicySchema,
  type MandatePolicy,
} from '../src/policy/schema.js'
import { evaluateIntent, freshLedger } from '../src/policy/engine.js'
import { SpendIntentSchema } from '../src/policy/schema.js'
import { clampMandateText } from './abuse-guard.js'

export type CopilotJson =
  | { ok: true; mode: 'draft' | 'revise' | 'explain'; draft?: unknown; explanation?: unknown; evaluation?: unknown; serv: unknown; brain: string }
  | { ok: false; error: string; fallback?: 'local' }

export async function handleCopilotBody(body: unknown): Promise<{ status: number; json: CopilotJson }> {
  if (!process.env.SERV_API_KEY?.trim()) {
    return {
      status: 503,
      json: {
        ok: false,
        error: 'SERV_API_KEY not configured on host',
        fallback: 'local',
      },
    }
  }

  const raw = (body ?? {}) as Record<string, unknown>
  const action = String(raw.action ?? 'draft')

  try {
    if (action === 'draft') {
      const mandateText = clampMandateText(String(raw.mandateText ?? ''))
      if (!mandateText.trim()) {
        return { status: 400, json: { ok: false, error: 'mandateText required' } }
      }
      const { draft, meta } = await draftPolicyWithServ(mandateText)
      return {
        status: 200,
        json: {
          ok: true,
          mode: 'draft',
          draft,
          brain: 'SERV Reasoning',
          serv: {
            model: meta.model,
            promptVersion: meta.promptVersion,
            reasoningEffort: meta.reasoningEffort,
            latencyMs: meta.latencyMs,
            usage: meta.usage,
            features: ['multipath', 'serv_prompt_guard', 'serv_shadow_agent'],
          },
        },
      }
    }

    if (action === 'revise') {
      const revisionText = clampMandateText(String(raw.revisionText ?? ''))
      if (!revisionText.trim()) {
        return { status: 400, json: { ok: false, error: 'revisionText required' } }
      }
      const currentPolicy = MandatePolicySchema.parse(raw.currentPolicy)
      const { draft, meta } = await revisePolicyWithServ({ currentPolicy, revisionText })
      return {
        status: 200,
        json: {
          ok: true,
          mode: 'revise',
          draft,
          brain: 'SERV Reasoning',
          serv: {
            model: meta.model,
            promptVersion: meta.promptVersion,
            latencyMs: meta.latencyMs,
            usage: meta.usage,
            features: ['multipath', 'serv_prompt_guard', 'serv_shadow_agent'],
          },
        },
      }
    }

    if (action === 'explain') {
      const policy = MandatePolicySchema.parse(raw.policy) as MandatePolicy
      const intent = SpendIntentSchema.parse(raw.intent)
      const evaluation =
        raw.evaluation != null
          ? EvaluationResultSchema.parse(raw.evaluation)
          : evaluateIntent(policy, intent, freshLedger())
      const { explanation, meta } = await explainDecisionWithServ({ policy, evaluation })
      return {
        status: 200,
        json: {
          ok: true,
          mode: 'explain',
          explanation,
          evaluation,
          brain: 'SERV Reasoning',
          serv: {
            model: meta.model,
            promptVersion: meta.promptVersion,
            latencyMs: meta.latencyMs,
            usage: meta.usage,
          },
        },
      }
    }

    return { status: 400, json: { ok: false, error: `Unknown action: ${action}` } }
  } catch (err) {
    return {
      status: 500,
      json: { ok: false, error: err instanceof Error ? err.message : String(err) },
    }
  }
}
