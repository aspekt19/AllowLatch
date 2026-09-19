/**
 * Coinbase AgentKit action provider — evaluate / assert before the agent signs.
 */
import { customActionProvider } from '@coinbase/agentkit'
import { z } from 'zod'
import { SpendIntentSchema } from '../policy/schema.js'
import { assertSpend } from './assert-spend.js'

const AssertSchema = z.object({
  action: SpendIntentSchema.shape.action,
  amountUsd: z.number().positive(),
  toAddress: z.string().optional(),
  symbol: z.string().optional(),
  tokenAddress: z.string().optional(),
  contractAddress: z.string().optional(),
  chainId: z.number().int().positive().optional(),
  calldataHash: z.string().optional(),
  reason: z.string().optional(),
  policyId: z.string().optional(),
})

/**
 * Registers `assert_spend` so LLM agents must clear AllowLatch before transfer tools.
 * Configure ALLOWLATCH_TRIGGER_URL (+ WALLET_PRIVATE_KEY as x402 payer).
 */
export function allowLatchActionProvider(opts?: {
  policyId?: string
  triggerUrl?: string
  workflowId?: number
  walletPrivateKey?: string
}) {
  const triggerUrl = opts?.triggerUrl ?? process.env.ALLOWLATCH_TRIGGER_URL
  const workflowId = opts?.workflowId ?? (process.env.ALLOWLATCH_WORKFLOW_ID
    ? Number(process.env.ALLOWLATCH_WORKFLOW_ID)
    : undefined)
  const walletPrivateKey = opts?.walletPrivateKey ?? process.env.WALLET_PRIVATE_KEY
  const defaultPolicyId = opts?.policyId ?? process.env.ALLOWLATCH_POLICY_ID ?? 'default'

  return customActionProvider([
    {
      name: 'assert_spend',
      description:
        'Call AllowLatch before any USDC transfer/swap/payment. Fail-closed: throws on DENY, timeout, or missing allow-receipt. On ALLOW returns receipt JSON — pass it to execute_gated_transfer / gated wallet. Never skip this for live funds.',
      schema: AssertSchema,
      invoke: async (args: z.infer<typeof AssertSchema>) => {
        const { policyId, ...intentFields } = args
        const result = await assertSpend({
          intent: intentFields,
          policyId: policyId ?? defaultPolicyId,
          triggerUrl,
          workflowId,
          walletPrivateKey,
        })
        return JSON.stringify({
          ok: true,
          decision: result.decision,
          receipt: result.receipt,
          evaluation: result.evaluation,
        })
      },
    },
  ])
}
