/** Re-export shared guards for Vercel `/api/*` handlers. */
export {
  allowedCopilotOrigins,
  checkBodySize,
  checkOrigin,
  checkRateLimit,
  clampMandateText,
  clientIp,
  COPILOT_LIMITS,
} from '../src/http/abuse-guard.js'
