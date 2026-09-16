/**
 * SpendGate — OpenServ agent
 *
 * NL mandate → Policy JSON
 * Spend intent → allow / deny / escalate (deterministic)
 * Optional: AgentKit USDC transfer on Base only after ALLOW
 */

import dotenv from 'dotenv'
dotenv.config()

import { Agent, run } from '@openserv-labs/sdk'
import { provision, triggers } from '@openserv-labs/client'
import { z } from 'zod'
import { MandatePolicySchema, SpendIntentSchema } from './policy/schema.js'
import { evaluateIntent } from './policy/engine.js'
import { PolicyStore } from './store/fs-store.js'
import { gatedTransfer, resolveExecuteMode } from './executor/gated-executor.js'
import {
  compileMandateWithServ,
  draftPolicyWithServ,
  revisePolicyWithServ,
} from './llm/compile-mandate.js'
import { explainDecisionWithServ } from './llm/explain-decision.js'

const store = new PolicyStore()

const agent = new Agent({
  systemPrompt: `You are SpendGate, Policy Copilot + spending turnstile for AI wallets on Base (Coinbase AgentKit).

LLM brain: SERV Reasoning — draft/revise mandates, surface conflicts, explain policies.
Policy decisions (allow/deny/escalate) are deterministic code — never invent overrides.

Your job:
1) draft_policy / revise_mandate — help the owner shape a MandatePolicy (conflicts, assumptions, questions).
2) apply_policy / compile_mandate — store a policy once the owner accepts it.
3) evaluate_intent / execute_gated_transfer — gate spends; AgentKit only after ALLOW.
4) explain_decision — after a gate result, explain why and suggest mandate edits (does not override the verdict).
5) Prefer draft_policy over silent compile when the mandate is ambiguous.

You are the turnstile. Be conservative: when ambiguous, prefer deny or escalate.`,
})

agent.addCapability({
  name: 'draft_policy',
  description:
    'Policy Copilot: draft a MandatePolicy from NL with conflicts, assumptions, and clarifying questions. Does NOT store until apply_policy.',
  inputSchema: z.object({
    mandateText: z.string().min(10),
  }),
  async run({ args }) {
    const { draft, meta } = await draftPolicyWithServ(args.mandateText)
    return JSON.stringify(
      {
        ok: true,
        draft,
        brain: 'SERV Reasoning (inference-api.openserv.ai)',
        serv: {
          model: meta.model,
          promptVersion: meta.promptVersion,
          reasoningEffort: meta.reasoningEffort,
          latencyMs: meta.latencyMs,
          usage: meta.usage,
        },
        note: draft.readyToApply
          ? 'Ready to apply_policy if the owner accepts.'
          : 'Answer questions / revise before apply_policy.',
      },
      null,
      2
    )
  },
})

agent.addCapability({
  name: 'revise_mandate',
  description:
    'Policy Copilot: revise a stored MandatePolicy from NL feedback; returns a new draft (conflicts/assumptions/questions). Does NOT store until apply_policy.',
  inputSchema: z.object({
    policyId: z.string().default('default'),
    revisionText: z.string().min(3),
  }),
  async run({ args }) {
    let current
    try {
      current = store.getPolicy(args.policyId)
    } catch {
      return JSON.stringify({ ok: false, error: `No policy stored for ${args.policyId}` })
    }
    const { draft, meta } = await revisePolicyWithServ({
      currentPolicy: current,
      revisionText: args.revisionText,
    })
    return JSON.stringify(
      {
        ok: true,
        policyId: args.policyId,
        draft,
        serv: {
          model: meta.model,
          promptVersion: meta.promptVersion,
          latencyMs: meta.latencyMs,
          usage: meta.usage,
        },
        note: 'Call apply_policy with draft.policy to persist.',
      },
      null,
      2
    )
  },
})

agent.addCapability({
  name: 'apply_policy',
  description:
    'Store a MandatePolicy JSON under policyId (usually draft.policy after owner review).',
  inputSchema: z.object({
    policyId: z.string().default('default'),
    policy: z.record(z.unknown()),
  }),
  async run({ args }) {
    const policy = MandatePolicySchema.parse(args.policy)
    await store.setPolicy(args.policyId, policy)
    return JSON.stringify({
      ok: true,
      policyId: args.policyId,
      policy,
      note: 'Stored. Call evaluate_intent or execute_gated_transfer before any Base spend.',
    })
  },
})

agent.addCapability({
  name: 'compile_mandate',
  description:
    'Compile NL mandate → MandatePolicy and store immediately (skips review). Prefer draft_policy + apply_policy for ambiguous mandates.',
  inputSchema: z.object({
    policyId: z.string().default('default'),
    mandateText: z.string().min(10),
  }),
  async run({ args }) {
    const { policy, meta } = await compileMandateWithServ(args.mandateText)
    await store.setPolicy(args.policyId, policy)

    return JSON.stringify(
      {
        ok: true,
        policyId: args.policyId,
        policy,
        brain: 'SERV Reasoning (inference-api.openserv.ai)',
        serv: {
          model: meta.model,
          promptVersion: meta.promptVersion,
          reasoningEffort: meta.reasoningEffort,
          latencyMs: meta.latencyMs,
          usage: meta.usage,
        },
        note: 'Policy stored on disk. Call evaluate_intent or execute_gated_transfer before any Base spend.',
      },
      null,
      2
    )
  },
})

agent.addCapability({
  name: 'get_policy',
  description: 'Return the stored MandatePolicy for a policyId.',
  inputSchema: z.object({
    policyId: z.string().default('default'),
  }),
  async run({ args }) {
    return JSON.stringify(
      {
        policyId: args.policyId,
        policy: store.getPolicy(args.policyId),
        ledger: store.getLedger(args.policyId),
        executeMode: resolveExecuteMode(),
      },
      null,
      2
    )
  },
})

agent.addCapability({
  name: 'evaluate_intent',
  description:
    'Deterministically evaluate a spend intent against a stored policy. Returns allow | deny | escalate. Does not send a transaction.',
  inputSchema: z.object({
    policyId: z.string().default('default'),
    intent: SpendIntentSchema,
  }),
  async run({ args }) {
    const policy = store.getPolicy(args.policyId)
    const ledger = store.getLedger(args.policyId)
    const result = evaluateIntent(policy, args.intent, ledger)

    return JSON.stringify(
      {
        ...result,
        ledger,
        executionHint:
          result.decision === 'allow'
            ? 'Call execute_gated_transfer to move USDC via AgentKit (or dry-run).'
            : result.decision === 'escalate'
              ? 'Wait for human confirmation, then execute_gated_transfer with humanApproved=true.'
              : 'Do NOT sign. Optionally call explain_decision, or revise_mandate / fix intent.',
      },
      null,
      2
    )
  },
})

agent.addCapability({
  name: 'explain_decision',
  description:
    'Policy Copilot: explain a prior evaluate_intent result in plain language and suggest mandate changes. Never overrides the gate verdict.',
  inputSchema: z.object({
    policyId: z.string().default('default'),
    intent: SpendIntentSchema,
  }),
  async run({ args }) {
    const policy = store.getPolicy(args.policyId)
    const ledger = store.getLedger(args.policyId)
    const evaluation = evaluateIntent(policy, args.intent, ledger)
    const { explanation, meta } = await explainDecisionWithServ({ policy, evaluation })
    return JSON.stringify(
      {
        ok: true,
        evaluation,
        explanation,
        serv: {
          model: meta.model,
          promptVersion: meta.promptVersion,
          latencyMs: meta.latencyMs,
          usage: meta.usage,
        },
        note: 'Verdict unchanged. Use revise_mandate + apply_policy if the owner wants different rules.',
      },
      null,
      2
    )
  },
})

agent.addCapability({
  name: 'execute_gated_transfer',
  description:
    'Evaluate policy then transfer USDC on Base via Coinbase AgentKit only if ALLOW (or escalate + humanApproved). Dry-run without CDP credentials.',
  inputSchema: z.object({
    policyId: z.string().default('default'),
    intent: SpendIntentSchema,
    humanApproved: z.boolean().default(false),
  }),
  async run({ args }) {
    const result = await gatedTransfer(store, {
      policyId: args.policyId,
      intent: args.intent,
      humanApproved: args.humanApproved,
    })
    return JSON.stringify(result, null, 2)
  },
})

agent.addCapability({
  name: 'reset_ledger',
  description: 'Reset the spend ledger for a policyId (demo / new day simulation).',
  inputSchema: z.object({
    policyId: z.string().default('default'),
  }),
  async run({ args }) {
    await store.resetLedger(args.policyId)
    return JSON.stringify({
      ok: true,
      policyId: args.policyId,
      ledger: store.getLedger(args.policyId),
    })
  },
})

async function main() {
  await store.init()

  const result = await provision({
    agent: {
      instance: agent,
      name: 'spendgate',
      description:
        'Turns human spending mandates into enforceable Base/USDC policies and gates AgentKit execution with allow/deny/escalate.',
    },
    workflow: {
      name: 'SpendGate',
      goal: 'Compile natural-language risk mandates into strict Base USDC spending policies, then deterministically evaluate each proposed agent spend and only allow Coinbase AgentKit to move funds after an explicit allow decision, with clear deny or human-escalation paths and an audit trail for autonomous AI wallets.',
      trigger: triggers.x402({
        name: 'SpendGate Evaluate',
        description:
          'Pay to compile a mandate or evaluate/execute a gated spend against SpendGate policy (Base USDC + AgentKit).',
        price: '0.01',
        timeout: 600,
        input: {
          prompt: {
            type: 'string',
            title: 'Request',
            description:
              'Describe a mandate to compile, or a spend to evaluate/execute (include policyId if not default).',
          },
        },
      }),
      task: {
        description:
          'Interpret the user request: compile_mandate from NL text, evaluate_intent for a proposed Base spend, or execute_gated_transfer only after policy ALLOW. Always use the deterministic policy engine for allow/deny decisions.',
      },
    },
  })

  console.log('SpendGate provisioned')
  console.log(`  agentId:      ${result.agentId}`)
  console.log(`  workflowId:   ${result.workflowId}`)
  console.log(`  executeMode:  ${resolveExecuteMode()}`)
  if (result.paywallUrl) console.log(`  paywall:      ${result.paywallUrl}`)

  await run(agent)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
