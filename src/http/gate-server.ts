/**
 * Framework-agnostic HTTP gate (no OpenServ required).
 *
 *   POST /v1/policies/:policyId          — apply MandatePolicy JSON
 *   GET  /v1/policies/:policyId          — get policy + ledger
 *   POST /v1/evaluate                    — evaluate_intent → receipt on ALLOW
 *   POST /v1/execute                     — gated transfer (receipt required)
 *   GET  /v1/audit?limit=50              — recent audit events
 *   POST /v1/ledgers/:policyId/reset     — reset day/hour windows (not lifetime); requires ownerToken
 *
 * Auth: Bearer ALLOWLATCH_HTTP_TOKEN required when not bound to loopback.
 * Bind 127.0.0.1 by default. Pack grant is local-dev only (token + ALLOWLATCH_DEV_PACKS=1).
 * Routes: POST /v1/packs/grant (preferred) · POST /v1/packs/purchase (alias).
 */
import dotenv from 'dotenv'
dotenv.config()

import http from 'node:http'
import { URL } from 'node:url'
import { z } from 'zod'
import { MandatePolicySchema, SpendIntentSchema } from '../policy/schema.js'
import { evaluateIntent } from '../policy/engine.js'
import { PolicyStore } from '../store/fs-store.js'
import { gatedTransfer, resolveExecuteMode } from '../executor/gated-executor.js'
import { issueAllowReceipt, parseAllowReceipt } from '../billing/receipt.js'
import {
  GATE_MAX_BODY_BYTES,
  assertJsonBodySize,
  isLoopbackHost,
  resolveCorsOrigin,
} from './abuse-guard.js'

const store = new PolicyStore()
const PORT = Number(process.env.ALLOWLATCH_HTTP_PORT || 8787)
const HOST = process.env.ALLOWLATCH_HTTP_HOST || '127.0.0.1'
const TOKEN = process.env.ALLOWLATCH_HTTP_TOKEN?.trim()
const DEV_PACKS = process.env.ALLOWLATCH_DEV_PACKS === '1'
const LOOPBACK = isLoopbackHost(HOST)

function corsHeaders(req: http.IncomingMessage): Record<string, string> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  const allowed = resolveCorsOrigin(origin)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  }
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed
  return headers
}

function json(req: http.IncomingMessage, res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders(req),
  })
  res.end(payload)
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > GATE_MAX_BODY_BYTES) {
      throw new Error(`Request body too large (max ${GATE_MAX_BODY_BYTES} bytes)`)
    }
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  assertJsonBodySize(raw, GATE_MAX_BODY_BYTES)
  return JSON.parse(raw)
}

function authorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) {
    // Open only on loopback for local integration tests.
    return LOOPBACK
  }
  const h = req.headers.authorization || ''
  return h === `Bearer ${TOKEN}`
}

function packsPurchaseAllowed(): boolean {
  // Never a public billing endpoint — OpenServ/x402 is the real path.
  // Local operator mint requires loopback + Bearer token (set ALLOWLATCH_DEV_PACKS=1 to acknowledge).
  return LOOPBACK && Boolean(TOKEN) && DEV_PACKS
}

async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === 'OPTIONS') {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
    if (origin && !resolveCorsOrigin(origin)) {
      res.writeHead(403).end()
      return
    }
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  const path = url.pathname

  if (path === '/health') {
    json(req, res, 200, {
      ok: true,
      executeMode: resolveExecuteMode(),
      authRequired: Boolean(TOKEN) || !LOOPBACK,
    })
    return
  }

  if (!authorized(req)) {
    json(req, res, 401, {
      ok: false,
      error: TOKEN
        ? 'unauthorized'
        : 'Set ALLOWLATCH_HTTP_TOKEN (required when not on loopback; recommended even locally)',
    })
    return
  }

  try {
    if (req.method === 'GET' && path.startsWith('/v1/policies/')) {
      const policyId = decodeURIComponent(path.slice('/v1/policies/'.length))
      let policy = null
      let ledger = null
      try {
        policy = store.getPolicy(policyId)
        ledger = store.getLedger(policyId)
      } catch {
        /* no policy yet — gated agents start fail-closed */
      }
      json(req, res, 200, {
        policyId,
        policy,
        ledger,
        executeMode: resolveExecuteMode(),
      })
      return
    }

    if (req.method === 'POST' && path.startsWith('/v1/policies/')) {
      const policyId = decodeURIComponent(path.slice('/v1/policies/'.length))
      const body = (await readJson(req)) as {
        policy?: unknown
        ownerId?: string
        ownerToken?: string
        operatorToken?: string
        ownerAddress?: string
        ownerSig?: string
      }
      const policy = MandatePolicySchema.parse(body.policy ?? body)
      try {
        const applied = await store.setPolicy(policyId, policy, body.ownerId ?? policy.ownerId, {
          ownerId: body.ownerId ?? policy.ownerId,
          ownerToken: body.ownerToken,
          operatorToken: body.operatorToken,
          ownerAddress: body.ownerAddress,
          ownerSig: body.ownerSig,
        })
        json(req, res, 200, {
          ok: true,
          policyId,
          policy,
          ownerToken: applied.ownerToken,
          ownerAddress: applied.ownerAddress,
          authMode: applied.mode,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const status = /ownerToken|ownerId|operator|ownerSig|ownerAddress/i.test(message) ? 403 : 400
        json(req, res, status, { ok: false, error: message })
      }
      return
    }

    if (req.method === 'POST' && path === '/v1/evaluate') {
      const body = z
        .object({
          policyId: z.string().default('default'),
          intent: SpendIntentSchema,
          packKey: z.string().optional(),
        })
        .parse(await readJson(req))
      let packCreditsRemaining: number | null | undefined
      if (body.packKey?.trim()) {
        packCreditsRemaining = store.tryConsumePackCredit(body.packKey.trim())
        if (packCreditsRemaining === null) {
          json(req, res, 402, {
            ok: false,
            error: 'No evaluate-pack credits. Buy via OpenServ x402 (buy_evaluate_pack), not this HTTP mint.',
          })
          return
        }
      }
      const policy = store.getPolicy(body.policyId)
      const ledger = store.getLedger(body.policyId)
      const evaluation = evaluateIntent(policy, body.intent, ledger)
      let receipt = null
      try {
        receipt = issueAllowReceipt({
          policyId: body.policyId,
          policy,
          intent: body.intent,
          evaluation,
        })
      } catch {
        receipt = null
      }
      await store.audit({
        type: receipt ? 'receipt.issued' : 'intent.evaluated',
        policyId: body.policyId,
        requestId: body.intent.requestId,
        payload: { decision: evaluation.decision, jti: receipt?.jti, packCreditsRemaining },
      })
      json(req, res, 200, { ...evaluation, ledger, receipt, packCreditsRemaining })
      return
    }

    if (req.method === 'POST' && (path === '/v1/packs/purchase' || path === '/v1/packs/grant')) {
      if (!packsPurchaseAllowed()) {
        json(req, res, 403, {
          ok: false,
          error:
            'HTTP pack mint disabled. Use OpenServ x402 buy_evaluate_pack, or set ALLOWLATCH_DEV_PACKS=1 on loopback with a token.',
        })
        return
      }
      const body = z
        .object({
          packKey: z.string().min(3),
          credits: z.number().int().positive().max(500).default(100),
        })
        .parse(await readJson(req))
      const credits = store.addPackCredits(body.packKey, body.credits)
      await store.audit({
        type: 'pack.granted',
        payload: { packKey: body.packKey, added: body.credits, credits, localDev: true, path },
      })
      json(req, res, 200, { ok: true, packKey: body.packKey, credits, localDev: true })
      return
    }

    if (req.method === 'GET' && path.startsWith('/v1/packs/')) {
      const packKey = decodeURIComponent(path.slice('/v1/packs/'.length))
      json(req, res, 200, { packKey, credits: store.getPackCredits(packKey) })
      return
    }

    if (req.method === 'POST' && path === '/v1/execute') {
      const body = z
        .object({
          policyId: z.string().default('default'),
          intent: SpendIntentSchema,
          humanApproved: z.boolean().optional(),
          receipt: z.record(z.unknown()).optional(),
          requestId: z.string().optional(),
        })
        .parse(await readJson(req))
      const result = await gatedTransfer(store, {
        policyId: body.policyId,
        intent: body.intent,
        humanApproved: body.humanApproved,
        receipt: parseAllowReceipt(body.receipt) ?? body.receipt,
        requestId: body.requestId,
      })
      json(req, res, 200, result)
      return
    }

    if (req.method === 'GET' && path === '/v1/audit') {
      const limit = Number(url.searchParams.get('limit') || 50)
      json(req, res, 200, { events: store.listAudit(Math.min(200, Math.max(1, limit))) })
      return
    }

    if (req.method === 'POST' && /^\/v1\/ledgers\/[^/]+\/reset$/.test(path)) {
      const policyId = decodeURIComponent(path.split('/')[3]!)
      const body = (await readJson(req).catch(() => ({}))) as {
        ownerToken?: string
        operatorToken?: string
      }
      try {
        const { assertPolicyRead } = await import('../auth/tenant.js')
        assertPolicyRead(store.getPolicyMeta(policyId), body)
        await store.resetDailyLedger(policyId)
        json(req, res, 200, {
          ok: true,
          policyId,
          ledger: store.getLedger(policyId),
          note: 'Day/hour windows reset; lifetime preserved unless ALLOWLATCH_RESET_LIFETIME=1 via operator tooling.',
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        json(req, res, /ownerToken|operator/i.test(message) ? 403 : 400, { ok: false, error: message })
      }
      return
    }

    json(req, res, 404, { ok: false, error: 'not found' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = /too large/i.test(message) ? 413 : 400
    json(req, res, status, { ok: false, error: message })
  }
}

async function main() {
  if (!LOOPBACK && !TOKEN) {
    console.error(
      '[http-gate] Refusing to bind non-loopback host without ALLOWLATCH_HTTP_TOKEN. Set the token or bind 127.0.0.1.'
    )
    process.exit(1)
  }

  await store.init()
  if (!process.env.ALLOWLATCH_RECEIPT_SECRET?.trim() && !process.env.SERV_API_KEY?.trim()) {
    process.env.ALLOWLATCH_RECEIPT_SECRET = 'dev-http-gate-receipt-secret'
    console.warn('[http-gate] using ephemeral ALLOWLATCH_RECEIPT_SECRET for local dev')
  }
  const server = http.createServer((req, res) => {
    void handler(req, res)
  })
  server.listen(PORT, HOST, () => {
    console.log(`AllowLatch HTTP gate on http://${HOST}:${PORT}`)
    console.log(`  executeMode: ${resolveExecuteMode()}`)
    console.log(
      `  auth: ${TOKEN ? 'Bearer token required' : LOOPBACK ? 'open loopback (set ALLOWLATCH_HTTP_TOKEN)' : 'token required'}`
    )
    console.log(
      `  packs/grant: ${packsPurchaseAllowed() ? 'local-dev enabled' : 'disabled (use OpenServ x402)'}`
    )
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
