/**
 * MandateGuard — OpenServ agent
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

const store = new PolicyStore()

const agent = new Agent({
  systemPrompt: `You are MandateGuard, a spending-policy agent for AI wallets on Base (Coinbase AgentKit).

Your job:
1) Turn human risk mandates into strict JSON policies (USDC on Base).
2) Evaluate proposed spends (swap / transfer / x402_pay) against that policy.
3) Optionally execute USDC transfers via AgentKit ONLY after ALLOW.
4) Explain allow / deny / escalate clearly.

You are the turnstile. Be conservative: when ambiguous, prefer deny or escalate.`,
})

agent.addCapability({
  name: 'compile_mandate',
  description:
    'Compile a natural-language spending mandate into a MandatePolicy JSON for Base/USDC and store it under policyId.',
  inputSchema: z.object({
    policyId: z.string().default('default'),
    mandateText: z.string().min(10),
  }),
  async run({ args, action }) {
    const draft = await this.generate({
      prompt: `Convert this human spending mandate into a MandatePolicy object for an AI agent wallet on Base (USDC only).

Mandate:
"""
${args.mandateText}
"""

Rules for you:
- chain must be "base", currency "USDC", version "1.0"
- Pick a short name
- Fill capital limits from the text; if missing, use safe defaults (maxPerOrderUsd 10, maxNotionalUsdPerDay 40, maxTransactionsPerHour 20, agentWalletBudgetUsd 200)
- allowedSymbols / deniedSymbols / allowedAddresses / deniedAddresses as arrays (empty if unspecified)
- If user mentions Uniswap, include Base Universal Router 0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD in allowedAddresses
- escalation.requireHumanConfirmAboveUsd: use stated confirm threshold, or slightly below maxPerOrderUsd so escalate can fire
- actions: enable swap/transfer/x402_pay unless user forbids them

Return ONLY valid JSON matching the schema — no markdown.`,
      outputSchema: MandatePolicySchema,
      action,
    })

    const policy = MandatePolicySchema.parse(draft)
    await store.setPolicy(args.policyId, policy)

    return JSON.stringify(
      {
        ok: true,
        policyId: args.policyId,
        policy,
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
              : 'Do NOT sign. Fix intent or update mandate.',
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
      name: 'mandateguard',
      description:
        'Turns human spending mandates into enforceable Base/USDC policies and gates AgentKit execution with allow/deny/escalate.',
    },
    workflow: {
      name: 'MandateGuard',
      goal: 'Compile natural-language risk mandates into strict Base USDC spending policies, then deterministically evaluate each proposed agent spend and only allow Coinbase AgentKit to move funds after an explicit allow decision, with clear deny or human-escalation paths and an audit trail for autonomous AI wallets.',
      trigger: triggers.x402({
        name: 'MandateGuard Evaluate',
        description:
          'Pay to compile a mandate or evaluate/execute a gated spend against MandateGuard policy (Base USDC + AgentKit).',
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

  console.log('MandateGuard provisioned')
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
