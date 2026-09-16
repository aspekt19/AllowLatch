/**
 * SpendGate — OpenServ agent
 *
 * Product path (wow / production):
 *   NL mandate → SERV Policy Copilot (host key) → MandatePolicy
 *   → deterministic allow/deny/escalate → AgentKit only after ALLOW
 *
 * End users and their agents never configure SERV_API_KEY or CDP.
 * Host holds SERV (and optional CDP). Bill via x402 per call.
 *
 * Optional advanced: src/owner/copilot.ts if an owner wants BYO Reasoning.
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
  systemPrompt: `You are SpendGate — Policy Copilot + spending turnstile for AI wallets on Base (Coinbase AgentKit).

SERV Reasoning (this host) drafts, revises, and explains policies: Multipath, prompt guard, shadow agent.
Allow / deny / escalate is ALWAYS deterministic code in the gate tools — never invent overrides.

Flow:
1) draft_policy / revise_mandate — show conflicts, assumptions, questions.
2) apply_policy — store when the owner accepts.
3) evaluate_intent / execute_gated_transfer — gate spends; AgentKit only after ALLOW.
4) explain_decision — after deny/escalate, explain without changing the verdict.

Never ask callers for SERV_API_KEY or CDP secrets — this host holds them.
Prefer draft_policy over silent compile when the mandate is ambiguous.
Be conservative: when ambiguous, prefer deny or escalate.`,
})

agent.addCapability({
  name: 'draft_policy',
  description:
    'Policy Copilot (SERV): draft a MandatePolicy from NL with conflicts, assumptions, and clarifying questions. Does NOT store until apply_policy.',
  inputSchema: z.object({
    mandateText: z.string().min(10),
  }),
  async run({ args }) {
    const { draft, meta } = await draftPolicyWithServ(args.mandateText)
    return JSON.stringify(
      {
        ok: true,
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
    'Policy Copilot (SERV): revise a stored MandatePolicy from NL feedback. Does NOT store until apply_policy.',
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
  description: 'Store a MandatePolicy JSON under policyId (usually draft.policy after owner review).',
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
    'Compile NL mandate → MandatePolicy and store immediately (skips review). Prefer draft_policy + apply_policy when ambiguous.',
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
        brain: 'SERV Reasoning',
        serv: {
          model: meta.model,
          promptVersion: meta.promptVersion,
          reasoningEffort: meta.reasoningEffort,
          latencyMs: meta.latencyMs,
          usage: meta.usage,
        },
        note: 'Policy stored. Call evaluate_intent or execute_gated_transfer before any Base spend.',
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
    'Policy Copilot (SERV): explain a gate result and suggest mandate edits. Never overrides the verdict.',
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

  if (!process.env.SERV_API_KEY?.trim()) {
    console.warn(
      '[spendgate] SERV_API_KEY missing — draft/revise/explain will fail until set. Gate evaluate still works.'
    )
  }

  const result = await provision({
    agent: {
      instance: agent,
      name: 'spendgate',
      description:
        'Policy Copilot + spending turnstile for AgentKit wallets on Base/USDC. SERV drafts mandates; deterministic gate allow/deny/escalates; AgentKit only after ALLOW. Connect via x402 — no end-user API keys.',
    },
    workflow: {
      name: 'SpendGate',
      goal: 'Let any financial AI agent connect without end-user API keys: SERV Reasoning drafts and revises natural-language spending mandates into strict Base USDC policies with conflicts and questions, then a deterministic gate evaluates each proposed spend as allow deny or escalate, explains denials via SERV, and only allows Coinbase AgentKit to move funds after ALLOW or human-approved escalation.',
      trigger: triggers.x402({
        name: 'SpendGate Gate',
        description:
          'Pay to draft/apply a mandate, evaluate a spend, explain a decision, or execute a gated USDC transfer on Base.',
        price: '0.1',
        timeout: 600,
        input: {
          prompt: {
            type: 'string',
            title: 'Request',
            description:
              'Natural language: set/revise a mandate, evaluate a spend, explain a deny, or execute after ALLOW. Include policyId if not default. No API keys required.',
          },
        },
      }),
      task: {
        description:
          'You are SpendGate for an external agent. Prefer draft_policy then apply_policy for mandates; use evaluate_intent before any move; use explain_decision after deny/escalate; use execute_gated_transfer only after ALLOW or escalate+humanApproved. Never invent allow/deny — always call the deterministic tools. Never ask the end user for SERV_API_KEY or CDP secrets.',
      },
    },
  })

  console.log('SpendGate provisioned')
  console.log(`  agentId:      ${result.agentId}`)
  console.log(`  workflowId:   ${result.workflowId}`)
  console.log(`  executeMode:  ${resolveExecuteMode()}`)
  console.log(`  serv:         ${process.env.SERV_API_KEY?.trim() ? 'ready' : 'MISSING'}`)
  if (result.paywallUrl) console.log(`  paywall:      ${result.paywallUrl}`)

  await run(agent)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
