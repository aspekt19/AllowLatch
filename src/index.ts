/**
 * Public SDK entry — import from 'allowlatch'.
 */
export { assertSpend, type AssertSpendResult } from './sdk/assert-spend.js'
export { createGatedAgentKit, type GatedAgentKit, type GatedGateConfig } from './sdk/gated-agentkit.js'
export {
  MandatePolicySchema,
  SpendIntentSchema,
  type MandatePolicy,
  type SpendIntent,
  type EvaluationResult,
  DEMO_POLICY,
} from './policy/schema.js'
export { evaluateIntent, commitIntent, freshLedger, rollLedger } from './policy/engine.js'
export {
  hashPolicy,
  hashAction,
  issueAllowReceipt,
  verifyAllowReceipt,
  type AllowReceipt,
} from './billing/receipt.js'
export {
  buildPolicyApplyTypedData,
  policyHashBytes32,
  hashPolicyApplyTypedData,
  POLICY_EIP712_DOMAIN,
  POLICY_EIP712_TYPES,
} from './auth/policy-eip712.js'
export { allowLatchActionProvider } from './sdk/allowlatch-action-provider.js'
