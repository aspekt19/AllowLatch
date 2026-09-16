/**
 * AllowLatch — OpenServ agent
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
import { logUsage } from './billing/usage-log.js'
import { issueAllowReceipt } from './billing/receipt.js'

const store = new PolicyStore()

const agent = new Agent({
  systemPrompt: `You are AllowLatch — Policy Copilot + spending turnstile for AI wallets on Base (Coinbase AgentKit).

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
    await logUsage({
      at: new Date().toISOString(),
      capability: 'draft_policy',
      meta: { model: meta.model, tokens: meta.usage?.totalTokens },
    })
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
    ownerId: z.string().optional(),
    policy: z.record(z.unknown()),
  }),
  async run({ args }) {
    const policy = MandatePolicySchema.parse({
      ...args.policy,
      ownerId: args.ownerId ?? (args.policy as { ownerId?: string }).ownerId,
    })
    await store.setPolicy(args.policyId, policy, args.ownerId ?? policy.ownerId)
    await logUsage({
      at: new Date().toISOString(),
      capability: 'apply_policy',
      policyId: args.policyId,
    })
    return JSON.stringify({
      ok: true,
      policyId: args.policyId,
      ownerId: policy.ownerId,
      policy,
      note: 'Stored on host (SQLite). Agents must call evaluate_intent then execute with allow-receipt — local JSON is not enforcement.',
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
    'Deterministically evaluate a spend intent against a stored policy. Returns allow | deny | escalate + allow-receipt. Does not send a transaction. Pass packKey to burn a prepaid evaluate credit ($1/25).',
  inputSchema: z.object({
    policyId: z.string().default('default'),
    intent: SpendIntentSchema,
    /** Prepaid pack key (wallet / client id). Burns 1 credit when present. */
    packKey: z.string().optional(),
  }),
  async run({ args }) {
    let packCreditsRemaining: number | null | undefined
    if (args.packKey?.trim()) {
      packCreditsRemaining = store.tryConsumePackCredit(args.packKey.trim())
      if (packCreditsRemaining === null) {
        return JSON.stringify({
          ok: false,
          error: 'No evaluate-pack credits. Call buy_evaluate_pack ($1 / 25) or omit packKey and pay per x402 call.',
        })
      }
    }
    const policy = store.getPolicy(args.policyId)
    const ledger = store.getLedger(args.policyId)
    const result = evaluateIntent(policy, args.intent, ledger)
    const receipt = (() => {
      try {
        return issueAllowReceipt({
          policyId: args.policyId,
          policy,
          intent: args.intent,
          evaluation: result,
        })
      } catch {
        return null
      }
    })()
    await store.audit({
      type: receipt ? 'receipt.issued' : 'intent.evaluated',
      policyId: args.policyId,
      requestId: args.intent.requestId,
      payload: {
        decision: result.decision,
        jti: receipt?.jti,
        packKey: args.packKey,
        packCreditsRemaining,
      },
    })
    await logUsage({
      at: new Date().toISOString(),
      capability: 'evaluate_intent',
      policyId: args.policyId,
      decision: result.decision,
    })
    return JSON.stringify(
      {
        ...result,
        ledger,
        receipt,
        packCreditsRemaining,
        receiptNote: receipt
          ? 'Single-use allow-receipt (jti + action digest + optional calldataHash). Pass into execute_gated_transfer.'
          : undefined,
        executionHint:
          result.decision === 'allow'
            ? 'Pass receipt into execute_gated_transfer (required). Do not sign without verifyAllowReceipt.'
            : result.decision === 'escalate'
              ? 'Wait for human confirmation, then execute_gated_transfer with humanApproved=true (mints+consumes receipt).'
              : 'Do NOT sign. Optionally call explain_decision, or revise_mandate / fix intent.',
      },
      null,
      2
    )
  },
})

agent.addCapability({
  name: 'buy_evaluate_pack',
  description:
    'Mint 25 prepaid evaluate credits for packKey (~$1 effective / $0.04 per check). Use with evaluate_intent.packKey.',
  inputSchema: z.object({
    packKey: z.string().min(3),
    credits: z.number().int().positive().max(500).default(25),
  }),
  async run({ args }) {
    const credits = store.addPackCredits(args.packKey, args.credits)
    await store.audit({
      type: 'pack.purchased',
      payload: { packKey: args.packKey, added: args.credits, credits },
    })
    return JSON.stringify({
      ok: true,
      packKey: args.packKey,
      credits,
      note: 'Pass the same packKey into evaluate_intent to burn credits instead of relying on per-call economics alone.',
    })
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
    'Re-evaluate, require/consume action-bound allow-receipt, then transfer USDC via AgentKit only on ALLOW (or escalate + humanApproved). Swaps: evaluate+receipt only — host does not submit swaps.',
  inputSchema: z.object({
    policyId: z.string().default('default'),
    intent: SpendIntentSchema,
    humanApproved: z.boolean().default(false),
    receipt: z.record(z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
  async run({ args }) {
    const result = await gatedTransfer(store, {
      policyId: args.policyId,
      intent: args.intent,
      humanApproved: args.humanApproved,
      receipt: args.receipt,
      requestId: args.requestId,
    })
    await logUsage({
      at: new Date().toISOString(),
      capability: 'execute_gated_transfer',
      policyId: args.policyId,
      decision: (result as { evaluation?: { decision?: string } }).evaluation?.decision,
    })
    return JSON.stringify(result, null, 2)
  },
})

agent.addCapability({
  name: 'list_audit',
  description: 'Return recent immutable-ish audit events (policy apply, evaluate, receipt, tx).',
  inputSchema: z.object({
    limit: z.number().int().positive().max(200).default(50),
  }),
  async run({ args }) {
    return JSON.stringify({ ok: true, events: store.listAudit(args.limit) }, null, 2)
  },
})

agent.addCapability({
  name: 'reset_ledger',
  description: 'Reset the spend ledger for a policyId (demo / new day simulation). Lifetime budget counters reset too.',
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
      '[allowlatch] SERV_API_KEY missing — draft/revise/explain will fail until set. Gate evaluate still works.'
    )
  }

  const result = await provision({
    agent: {
      instance: agent,
      name: 'allowlatch',
      description:
        'Policy Copilot + spending turnstile for AgentKit wallets on Base/USDC. SERV drafts mandates; deterministic gate allow/deny/escalates; AgentKit only after ALLOW. Connect via x402 — no end-user API keys.',
    },
    workflow: {
      name: 'AllowLatch',
      goal: 'Let any financial AI agent connect without end-user API keys: SERV Reasoning drafts and revises natural-language spending mandates into strict Base USDC policies with conflicts and questions, then a deterministic gate evaluates each proposed spend as allow deny or escalate, explains denials via SERV, and only allows Coinbase AgentKit to move funds after ALLOW or human-approved escalation.',
      trigger: triggers.x402({
        name: 'AllowLatch Gate',
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
          'You are AllowLatch for an external agent. Prefer draft_policy then apply_policy for mandates; use evaluate_intent before any move; use explain_decision after deny/escalate; use execute_gated_transfer only after ALLOW or escalate+humanApproved. Never invent allow/deny — always call the deterministic tools. Never ask the end user for SERV_API_KEY or CDP secrets.',
      },
    },
  })

  console.log('AllowLatch provisioned')
  console.log(`  agentId:      ${result.agentId}`)
  console.log(`  workflowId:   ${result.workflowId}`)
  console.log(`  executeMode:  ${resolveExecuteMode()}`)
  console.log(`  serv:         ${process.env.SERV_API_KEY?.trim() ? 'ready' : 'MISSING'}`)
  if (result.paywallUrl) {
    console.log(`  paywall:      ${result.paywallUrl}`)
    console.log(
      '  tip: set ALLOWLATCH_PAYWALL_URL to this value for the demo UI “Enforce” button (Vercel/.env)'
    )
  }

  await run(agent)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
