#!/usr/bin/env node
/**
 * AllowLatch MCP server — evaluate / assert_spend for agent hosts that speak MCP.
 *
 *   npm run mcp
 *
 * Env: ALLOWLATCH_TRIGGER_URL, WALLET_PRIVATE_KEY (x402 payer), optional ALLOWLATCH_POLICY_ID
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { assertSpend } from '../sdk/assert-spend.js'
import {
  buildPolicyApplyTypedData,
  policyHashBytes32,
} from '../auth/policy-eip712.js'
import { MandatePolicySchema } from '../policy/schema.js'

const server = new McpServer({
  name: 'allowlatch',
  version: '0.1.0',
})

server.registerTool(
  'assert_spend',
  {
    description:
      'Fail-closed AllowLatch gate: pay x402 evaluate, require ALLOW + allow-receipt before signing.',
    inputSchema: {
      action: z.enum(['swap', 'transfer', 'x402_pay']),
      amountUsd: z.number().positive(),
      toAddress: z.string().optional(),
      symbol: z.string().optional(),
      tokenAddress: z.string().optional(),
      contractAddress: z.string().optional(),
      chainId: z.number().int().positive().optional(),
      calldataHash: z.string().optional(),
      reason: z.string().optional(),
      policyId: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const { policyId, ...intent } = args
      const result = await assertSpend({
        intent,
        policyId: policyId ?? process.env.ALLOWLATCH_POLICY_ID ?? 'default',
        triggerUrl: process.env.ALLOWLATCH_TRIGGER_URL,
        workflowId: process.env.ALLOWLATCH_WORKFLOW_ID
          ? Number(process.env.ALLOWLATCH_WORKFLOW_ID)
          : undefined,
        walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      }
    }
  }
)

server.registerTool(
  'policy_apply_typed_data',
  {
    description:
      'Build EIP-712 MandatePolicyApply typed data for the owner to sign before apply_policy.',
    inputSchema: {
      policyId: z.string(),
      ownerId: z.string(),
      policy: z.record(z.unknown()),
      chainId: z.number().int().positive().optional(),
    },
  },
  async (args) => {
    const policy = MandatePolicySchema.parse(args.policy)
    const typedData = buildPolicyApplyTypedData({
      policyId: args.policyId,
      policy,
      ownerId: args.ownerId,
      chainId: args.chainId,
    })
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              typedData,
              policyHash: policyHashBytes32(policy),
              note: 'Sign typedData with the owner wallet, then pass ownerSig + ownerAddress into apply_policy.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
