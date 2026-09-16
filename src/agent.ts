/**
 * SpendGate — OpenServ agent (keyless gate host)
 *
 * Consumer path: apply_policy + evaluate / execute. No SERV key required.
 * Owner-side agents draft/revise/explain with *their* SERV_API_KEY
 * (see src/owner/copilot.ts) and only send MandatePolicy JSON here.
 *
 * Operator path: if SERV_API_KEY is set on this host, optional Copilot
 * capabilities are registered for our own / dev use only — never for
 * storing end-user keys.
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
const operatorServEnabled = Boolean(process.env.SERV_API_KEY?.trim())

const agent = new Agent({
  systemPrompt: `You are SpendGate, the spending turnstile for AI wallets on Base (Coinbase AgentKit).

Primary job (keyless gate):
1) apply_policy — store MandatePolicy JSON the owner already drafted on their side.
2) evaluate_intent — deterministic allow | deny | escalate (never invent overrides).
3) execute_gated_transfer — AgentKit USDC only after ALLOW (or escalate + humanApproved).
4) get_policy / reset_ledger — inspect / demo helpers.

Do NOT ask callers for SERV_API_KEY or CDP secrets.
If an external agent sends a raw NL mandate without policy JSON, tell them to draft on the owner agent (owner SERV key) and call apply_policy with the resulting MandatePolicy.
${
  operatorServEnabled
    ? `\nOperator mode (host SERV_API_KEY present): draft_policy / revise_mandate / compile_mandate / explain_decision are available for the host operator only.`
    : `\nCopilot (draft/revise/explain) is not on this host — owners run it with their own SERV key.`
}

Be conservative: when ambiguous, prefer deny or escalate.`,
})

agent.addCapability({
  name: 'apply_policy',
  description:
    'Store a MandatePolicy JSON under policyId (owner-side draft after review). Keyless — no SERV.',
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
        operatorServ: operatorServEnabled,
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
              : 'Do NOT sign. Explain on the owner agent (owner SERV key), or revise policy and apply_policy again.',
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

if (operatorServEnabled) {
  agent.addCapability({
    name: 'draft_policy',
    description:
      'OPERATOR ONLY: draft MandatePolicy via host SERV_API_KEY. End-user agents should draft on their side.',
    inputSchema: z.object({
      mandateText: z.string().min(10),
    }),
    async run({ args }) {
      const { draft, meta } = await draftPolicyWithServ(args.mandateText)
      return JSON.stringify(
        {
          ok: true,
          draft,
          brain: 'SERV Reasoning (host operator key)',
          serv: {
            model: meta.model,
            promptVersion: meta.promptVersion,
            reasoningEffort: meta.reasoningEffort,
            latencyMs: meta.latencyMs,
            usage: meta.usage,
          },
          note: draft.readyToApply
            ? 'Ready to apply_policy if the operator accepts.'
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
      'OPERATOR ONLY: revise stored policy via host SERV. End users revise on their agent.',
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
    name: 'compile_mandate',
    description:
      'OPERATOR ONLY: NL → MandatePolicy and store immediately (skips review). Prefer owner-side draft for end users.',
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
          brain: 'SERV Reasoning (host operator key)',
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
    name: 'explain_decision',
    description:
      'OPERATOR ONLY: explain a gate result via host SERV. End users explain on their agent.',
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
          note: 'Verdict unchanged. Owner revises on their agent, then apply_policy.',
        },
        null,
        2
      )
    },
  })
}

async function main() {
  await store.init()

  const result = await provision({
    agent: {
      instance: agent,
      name: 'spendgate',
      description:
        'Keyless spending turnstile for AgentKit wallets on Base/USDC. Owners draft policy with their own SERV key; this host only stores MandatePolicy JSON and allow/deny/escalates. Optional AgentKit execute after ALLOW.',
    },
    workflow: {
      name: 'SpendGate',
      goal: 'Let any financial AI agent connect without giving SpendGate their SERV key: receive an owner-drafted MandatePolicy via apply_policy, deterministically evaluate each proposed spend as allow deny or escalate, and only allow Coinbase AgentKit to move funds after ALLOW or human-approved escalation. Host CDP secrets stay with the operator; owner SERV keys stay on the owner agent.',
      trigger: triggers.x402({
        name: 'SpendGate Gate',
        description:
          'Pay to apply a MandatePolicy JSON, evaluate a spend, or execute a gated USDC transfer on Base.',
        price: '0.01',
        timeout: 600,
        input: {
          prompt: {
            type: 'string',
            title: 'Request',
            description:
              'Prefer: apply_policy with MandatePolicy JSON; evaluate_intent; or execute_gated_transfer after ALLOW. Include policyId if not default. Do not send SERV_API_KEY.',
          },
        },
      }),
      task: {
        description:
          'You are the SpendGate gate for an external agent. Expect apply_policy with MandatePolicy JSON (drafted on the owner agent with the owner SERV key). Use evaluate_intent before any move; execute_gated_transfer only after ALLOW or escalate+humanApproved. Never invent allow/deny — always call the deterministic tools. Never ask for or accept SERV_API_KEY. If they only send NL without policy JSON, tell them to draft on their side first.',
      },
    },
  })

  console.log('SpendGate provisioned (keyless gate)')
  console.log(`  agentId:      ${result.agentId}`)
  console.log(`  workflowId:   ${result.workflowId}`)
  console.log(`  executeMode:  ${resolveExecuteMode()}`)
  console.log(
    `  operatorServ: ${operatorServEnabled ? 'on (host key for self/dev)' : 'off (gate only)'}`
  )
  if (result.paywallUrl) console.log(`  paywall:      ${result.paywallUrl}`)

  await run(agent)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
