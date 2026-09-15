import { z } from 'zod'

/** Human-facing spend mandate, compiled into this schema. */
export const MandatePolicySchema = z.object({
  version: z.literal('1.0'),
  name: z.string().min(1).max(80),
  chain: z.literal('base'),
  currency: z.literal('USDC'),
  capital: z.object({
    /** Soft ceiling for the agent wallet (informational). */
    agentWalletBudgetUsd: z.number().nonnegative(),
    maxNotionalUsdPerDay: z.number().positive(),
    maxPerOrderUsd: z.number().positive(),
    maxTransactionsPerHour: z.number().int().positive().default(30),
  }),
  universe: z.object({
    /** Empty = any token symbol allowed (still subject to address rules). */
    allowedSymbols: z.array(z.string()).default([]),
    deniedSymbols: z.array(z.string()).default([]),
    /** If non-empty, destination must be on this list. */
    allowedAddresses: z.array(z.string()).default([]),
    deniedAddresses: z.array(z.string()).default([]),
  }),
  actions: z.object({
    allowSwap: z.boolean().default(true),
    allowTransfer: z.boolean().default(true),
    allowX402Pay: z.boolean().default(true),
  }),
  escalation: z.object({
    requireHumanConfirmAboveUsd: z.number().nonnegative(),
  }),
})

export type MandatePolicy = z.infer<typeof MandatePolicySchema>

export const SpendIntentSchema = z.object({
  action: z.enum(['swap', 'transfer', 'x402_pay']),
  amountUsd: z.number().positive(),
  /** Token symbol for swaps, optional otherwise. */
  symbol: z.string().optional(),
  /** Destination / router / payTo address when known. */
  toAddress: z.string().optional(),
  /** Free-text reason from the strategy agent. */
  reason: z.string().optional(),
})

export type SpendIntent = z.infer<typeof SpendIntentSchema>

export const SpendLedgerSchema = z.object({
  dayKey: z.string(), // YYYY-MM-DD UTC
  spentUsdToday: z.number().nonnegative().default(0),
  hourKey: z.string(), // YYYY-MM-DD-HH UTC
  txCountThisHour: z.number().int().nonnegative().default(0),
})

export type SpendLedger = z.infer<typeof SpendLedgerSchema>

export const EvaluationResultSchema = z.object({
  decision: z.enum(['allow', 'deny', 'escalate']),
  reasons: z.array(z.string()).min(1),
  policyName: z.string(),
  remainingDailyUsd: z.number(),
  intent: SpendIntentSchema,
})

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>

/** Example starter policy for demos. */
export const DEMO_POLICY: MandatePolicy = {
  version: '1.0',
  name: 'Base starter card',
  chain: 'base',
  currency: 'USDC',
  capital: {
    agentWalletBudgetUsd: 200,
    maxNotionalUsdPerDay: 40,
    maxPerOrderUsd: 15,
    maxTransactionsPerHour: 20,
  },
  universe: {
    allowedSymbols: ['USDC', 'ETH', 'WETH'],
    deniedSymbols: ['PEPE', 'RANDOM'],
    // Uniswap Universal Router on Base (example allowlist entry)
    allowedAddresses: [
      '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
    ],
    deniedAddresses: [],
  },
  actions: {
    allowSwap: true,
    allowTransfer: true,
    allowX402Pay: true,
  },
  escalation: {
    // Above this → escalate; still must be ≤ maxPerOrderUsd to not hard-deny
    requireHumanConfirmAboveUsd: 10,
  },
}
