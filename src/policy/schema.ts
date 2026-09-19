import { z } from 'zod'

/** Human-facing spend mandate, compiled into this schema. */
export const MandatePolicySchema = z.object({
  version: z.literal('1.0'),
  name: z.string().min(1).max(80),
  /** Optional owner identity (wallet / OpenServ user / org id). */
  ownerId: z.string().min(1).max(120).optional(),
  /** Optional agent / spender identity this policy binds to. */
  agentId: z.string().min(1).max(120).optional(),
  chain: z.enum(['base', 'base-sepolia']).default('base'),
  currency: z.literal('USDC'),
  capital: z.object({
    /**
     * Hard lifetime ceiling for this policy ledger (enforced in engine.ts).
     * Middleware-level — pair with wallet-native Spend Permissions for custody-grade caps.
     */
    agentWalletBudgetUsd: z.number().nonnegative(),
    maxNotionalUsdPerDay: z.number().positive(),
    maxPerOrderUsd: z.number().positive(),
    maxTransactionsPerHour: z.number().int().positive().default(30),
    /** Optional soft gas budget tracking (USD-equivalent estimate from intent.meta). */
    maxGasUsdPerDay: z.number().nonnegative().optional(),
  }),
  universe: z.object({
    /** Empty = any token symbol allowed (still subject to address rules). */
    allowedSymbols: z.array(z.string()).default([]),
    deniedSymbols: z.array(z.string()).default([]),
    /** If non-empty, destination must be on this list. */
    allowedAddresses: z.array(z.string()).default([]),
    deniedAddresses: z.array(z.string()).default([]),
    /** Contract allow/deny for swaps / approvals (checked when intent.contractAddress set). */
    allowedContracts: z.array(z.string()).default([]),
    deniedContracts: z.array(z.string()).default([]),
    /**
     * ERC-20 (or native sentinel) token contracts allowed for spends.
     * Prefer this over symbols alone — same ticker can map to different contracts.
     * Empty = no contract-level token filter (symbol rules still apply).
     */
    allowedTokenAddresses: z.array(z.string()).default([]),
    deniedTokenAddresses: z.array(z.string()).default([]),
    /** If non-empty, intent.functionSelector must be on this list (4-byte selectors). */
    allowedFunctionSelectors: z.array(z.string()).default([]),
    deniedFunctionSelectors: z.array(z.string()).default([]),
  }),
  actions: z.object({
    allowSwap: z.boolean().default(true),
    allowTransfer: z.boolean().default(true),
    allowX402Pay: z.boolean().default(true),
  }),
  risk: z
    .object({
      /** Max slippage in basis points for swap intents (deny if intent.slippageBps exceeds). */
      maxSlippageBps: z.number().int().nonnegative().optional(),
      /** When true, all spends deny immediately. */
      emergencyStop: z.boolean().default(false),
    })
    .default({ emergencyStop: false }),
  escalation: z.object({
    requireHumanConfirmAboveUsd: z.number().nonnegative(),
  }),
})

export type MandatePolicy = z.infer<typeof MandatePolicySchema>

export const SpendIntentSchema = z.object({
  action: z.enum(['swap', 'transfer', 'x402_pay']),
  amountUsd: z.number().positive(),
  /** Token symbol for swaps, optional otherwise. Prefer tokenAddress when known. */
  symbol: z.string().optional(),
  /** ERC-20 token contract (or native asset sentinel). Stronger than symbol alone. */
  tokenAddress: z.string().optional(),
  /** Destination / router / payTo address when known. */
  toAddress: z.string().optional(),
  /** Target contract (router, vault, etc.) when distinct from toAddress. */
  contractAddress: z.string().optional(),
  /** Spender / allowance target when relevant (approvals). */
  spenderAddress: z.string().optional(),
  /** EVM chain id (8453 = Base, 84532 = Base Sepolia). Binds receipt + policy.chain. */
  chainId: z.number().int().positive().optional(),
  /** Optional network id string (base / base-sepolia). */
  networkId: z.string().optional(),
  /** Requested slippage in bps for swaps. */
  slippageBps: z.number().int().nonnegative().optional(),
  /** Estimated gas cost in USD for daily gas cap checks. */
  estimatedGasUsd: z.number().nonnegative().optional(),
  /** 4-byte function selector, e.g. 0xa9059cbb (transfer). */
  functionSelector: z
    .string()
    .regex(/^0x[a-fA-F0-9]{8}$/, 'functionSelector must be 0x + 8 hex chars')
    .optional(),
  /** keccak256 (or sha256) of intended calldata — required for swap intents by the gate; binds allow-receipt to exact bytes. */
  calldataHash: z.string().min(16).max(66).optional(),
  /** Free-text reason from the strategy agent. */
  reason: z.string().optional(),
  /** Caller-supplied idempotency / correlation id. */
  requestId: z.string().optional(),
})

export type SpendIntent = z.infer<typeof SpendIntentSchema>

export const SpendLedgerSchema = z.object({
  dayKey: z.string(), // YYYY-MM-DD UTC
  spentUsdToday: z.number().nonnegative().default(0),
  hourKey: z.string(), // YYYY-MM-DD-HH UTC
  txCountThisHour: z.number().int().nonnegative().default(0),
  /** Cumulative spend under this policy (lifetime wallet budget). */
  spentUsdLifetime: z.number().nonnegative().default(0),
  gasUsdToday: z.number().nonnegative().default(0),
})

export type SpendLedger = z.infer<typeof SpendLedgerSchema>

export const EvaluationResultSchema = z.object({
  decision: z.enum(['allow', 'deny', 'escalate']),
  reasons: z.array(z.string()).min(1),
  policyName: z.string(),
  remainingDailyUsd: z.number(),
  remainingLifetimeUsd: z.number().optional(),
  intent: SpendIntentSchema,
})

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>

/** Policy Copilot draft — policy plus judgment metadata (SERV). */
export const PolicyDraftSchema = z.object({
  policy: MandatePolicySchema,
  /** Internal tensions or contradictions found in the mandate. */
  conflicts: z.array(z.string()).default([]),
  /** Defaults or interpretations applied where the mandate was silent/ambiguous. */
  assumptions: z.array(z.string()).default([]),
  /** Clarifying questions for the owner before applying the policy. */
  questions: z.array(z.string()).default([]),
  /** true when safe to apply without answering questions (conflicts may still warn). */
  readyToApply: z.boolean(),
  summary: z.string().min(1).max(400),
})

export type PolicyDraft = z.infer<typeof PolicyDraftSchema>

/** Human-readable explanation of a gate decision (SERV Copilot). */
export const DecisionExplanationSchema = z.object({
  headline: z.string().min(1).max(160),
  explanation: z.string().min(1).max(800),
  /** Concrete mandate edits the owner could make if they want a different outcome. */
  suggestedMandateChanges: z.array(z.string()).default([]),
  /** Whether the spend could pass after a policy revise (not after ignoring the gate). */
  revisable: z.boolean(),
})

export type DecisionExplanation = z.infer<typeof DecisionExplanationSchema>

/** Example starter policy for demos. */
export const DEMO_POLICY: MandatePolicy = {
  version: '1.0',
  name: 'Base starter card',
  ownerId: 'demo-owner',
  agentId: 'demo-spender',
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
    allowedAddresses: ['0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'],
    deniedAddresses: [],
    allowedContracts: [],
    deniedContracts: [],
    allowedTokenAddresses: [],
    deniedTokenAddresses: [],
    allowedFunctionSelectors: [],
    deniedFunctionSelectors: [],
  },
  actions: {
    allowSwap: true,
    allowTransfer: true,
    allowX402Pay: true,
  },
  risk: {
    maxSlippageBps: 100,
    emergencyStop: false,
  },
  escalation: {
    // Above this → escalate; still must be ≤ maxPerOrderUsd to not hard-deny
    requireHumanConfirmAboveUsd: 10,
  },
}
