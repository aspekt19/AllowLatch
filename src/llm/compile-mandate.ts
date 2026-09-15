/**
 * Shared mandate → MandatePolicy compiler via SERV Reasoning.
 *
 * Uses Day One + feature docs:
 * - versioned system prompt (stable behavior in system; mandate in user)
 * - structured outputs + Zod validate
 * - reasoning_effort medium (multi-constraint judgment)
 * - Multipath model suffix for branching policy rules
 * - serv_prompt_guard (mandate text is user-controlled)
 * - serv_shadow_agent (raise structured accuracy)
 *
 * Decisions stay in engine.ts — this only compiles policy JSON.
 */
import { MandatePolicySchema, type MandatePolicy } from '../policy/schema.js'
import {
  SERV_DEFAULT_MODEL,
  servStructured,
  type ServMeta,
} from './serv-reasoning.js'

export const COMPILER_PROMPT_VERSION = 'spendgate-compile-v2'

/** Uniswap Universal Router on Base — only when mandate mentions Uniswap. */
export const BASE_UNISWAP_UNIVERSAL_ROUTER =
  '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'

/**
 * Multipath: better for branching / competing rules (policy matrices).
 * Override with SERV_COMPILE_MODEL (without requiring multipath).
 */
export function resolveCompileModel(): string {
  if (process.env.SERV_COMPILE_MODEL) return process.env.SERV_COMPILE_MODEL
  const base = process.env.SERV_MODEL ?? SERV_DEFAULT_MODEL
  // Avoid double-suffix if caller already set a feature model
  if (base.includes('-serv-')) return base
  return `${base}-serv-multipath`
}

/**
 * System prompt = application logic (Day One §3).
 * Keep mandate text out of here — it goes in the user message.
 */
export const COMPILE_SYSTEM_PROMPT = `You are SpendGate's mandate compiler for AI agent wallets on Base.

Objective: turn a human spending mandate into a strict MandatePolicy JSON that a deterministic gate will enforce. You do not approve spends; you only compile rules.

Decision priorities (highest first):
1. Safety — prefer tighter limits when the mandate is ambiguous.
2. Fidelity — encode every explicit number, symbol, address, and action the human stated.
3. Conservatism — when a limit is missing, use safe defaults below (never invent generous caps).
4. Clarity — short policy name; no commentary outside the schema.

Non-negotiable constraints:
- version must be "1.0"
- chain must be "base"
- currency must be "USDC" (Base USDC only; do not invent other settlement currencies)
- Do not invent token symbols. Only include symbols the mandate clearly allows (USDC, ETH, WETH, or named tickers). Never invent junk words from the mandate as tickers.
- Do not invent contract addresses. Only include addresses the mandate names, or the known Uniswap Universal Router on Base when Uniswap is mentioned: ${BASE_UNISWAP_UNIVERSAL_ROUTER}
- deniedSymbols: put meme / explicitly banned tickers (e.g. PEPE) when the human forbids memes or names them
- If allowedAddresses is non-empty, the gate will require destinations to be on that list — only populate it when the mandate implies an allowlist
- escalation.requireHumanConfirmAboveUsd must be ≤ maxPerOrderUsd; if the human says "ask me above $X", use X; otherwise set slightly below maxPerOrderUsd so escalate can fire in demos

Safe defaults when the mandate omits a value:
- agentWalletBudgetUsd: 200
- maxNotionalUsdPerDay: 40
- maxPerOrderUsd: 10
- maxTransactionsPerHour: 20
- allowSwap / allowTransfer / allowX402Pay: true unless the human forbids them

Missing information: leave arrays empty rather than guessing. Prefer deny-friendly allowlists over open-ended universe.

Abstain from narrative explanations — output only fields that fit MandatePolicy.`

const SHADOW_HINT =
  'Valid MandatePolicy only: chain=base, currency=USDC, version=1.0; numeric caps conservative; no invented tickers or addresses; requireHumanConfirmAboveUsd ≤ maxPerOrderUsd.'

export async function compileMandateWithServ(
  mandateText: string
): Promise<{ policy: MandatePolicy; meta: ServMeta }> {
  const text = mandateText.trim()
  if (text.length < 10) {
    throw new Error('mandateText too short')
  }

  const { data, meta } = await servStructured({
    system: COMPILE_SYSTEM_PROMPT,
    user: `Compile this human spending mandate into a MandatePolicy object.

Mandate:
"""
${text}
"""`,
    schema: MandatePolicySchema,
    schemaName: 'mandate_policy',
    model: resolveCompileModel(),
    reasoningEffort: 'medium',
    promptVersion: COMPILER_PROMPT_VERSION,
    servTools: {
      promptGuard: true,
      shadowAgent: {
        hint: SHADOW_HINT,
        maxIterations: 3,
      },
    },
  })

  // Application-side validation (Day One): structured outputs are not enough alone
  const policy = MandatePolicySchema.parse(data)
  return { policy, meta }
}
