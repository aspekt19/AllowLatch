/**
 * Framework-agnostic HTTP gate (no OpenServ required).
 *
 *   POST /v1/policies/:policyId          — apply MandatePolicy JSON
 *   GET  /v1/policies/:policyId          — get policy + ledger
 *   POST /v1/evaluate                    — evaluate_intent → receipt on ALLOW
 *   POST /v1/execute                     — gated transfer (receipt required)
 *   GET  /v1/audit?limit=50              — recent audit events
 *   POST /v1/ledgers/:policyId/reset     — reset ledger
 *
 * Auth: optional Bearer ALLOWLATCH_HTTP_TOKEN. Bind 127.0.0.1 by default.
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

const store = new PolicyStore()
const PORT = Number(process.env.ALLOWLATCH_HTTP_PORT || 8787)
const HOST = process.env.ALLOWLATCH_HTTP_HOST || '127.0.0.1'
const TOKEN = process.env.ALLOWLATCH_HTTP_TOKEN?.trim()

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(payload)
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function authorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) return true
  const h = req.headers.authorization || ''
  return h === `Bearer ${TOKEN}`
}

async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  const path = url.pathname

  if (path === '/health') {
    json(res, 200, { ok: true, executeMode: resolveExecuteMode() })
    return
  }

  if (!authorized(req)) {
    json(res, 401, { ok: false, error: 'unauthorized' })
    return
  }

  try {
    if (req.method === 'GET' && path.startsWith('/v1/policies/')) {
      const policyId = decodeURIComponent(path.slice('/v1/policies/'.length))
      json(res, 200, {
        policyId,
        policy: store.getPolicy(policyId),
        ledger: store.getLedger(policyId),
        executeMode: resolveExecuteMode(),
      })
      return
    }

    if (req.method === 'POST' && path.startsWith('/v1/policies/')) {
      const policyId = decodeURIComponent(path.slice('/v1/policies/'.length))
      const body = (await readJson(req)) as { policy?: unknown; ownerId?: string }
      const policy = MandatePolicySchema.parse(body.policy ?? body)
      await store.setPolicy(policyId, policy, body.ownerId ?? policy.ownerId)
      json(res, 200, { ok: true, policyId, policy })
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
          json(res, 402, {
            ok: false,
            error: 'No evaluate-pack credits. POST /v1/packs/purchase first.',
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
      json(res, 200, { ...evaluation, ledger, receipt, packCreditsRemaining })
      return
    }

    if (req.method === 'POST' && path === '/v1/packs/purchase') {
      const body = z
        .object({
          packKey: z.string().min(3),
          credits: z.number().int().positive().max(500).default(100),
        })
        .parse(await readJson(req))
      const credits = store.addPackCredits(body.packKey, body.credits)
      await store.audit({
        type: 'pack.purchased',
        payload: { packKey: body.packKey, added: body.credits, credits },
      })
      json(res, 200, { ok: true, packKey: body.packKey, credits })
      return
    }

    if (req.method === 'GET' && path.startsWith('/v1/packs/')) {
      const packKey = decodeURIComponent(path.slice('/v1/packs/'.length))
      json(res, 200, { packKey, credits: store.getPackCredits(packKey) })
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
      json(res, 200, result)
      return
    }

    if (req.method === 'GET' && path === '/v1/audit') {
      const limit = Number(url.searchParams.get('limit') || 50)
      json(res, 200, { events: store.listAudit(Math.min(200, Math.max(1, limit))) })
      return
    }

    if (req.method === 'POST' && /^\/v1\/ledgers\/[^/]+\/reset$/.test(path)) {
      const policyId = decodeURIComponent(path.split('/')[3]!)
      await store.resetLedger(policyId)
      json(res, 200, { ok: true, policyId, ledger: store.getLedger(policyId) })
      return
    }

    json(res, 404, { ok: false, error: 'not found' })
  } catch (err) {
    json(res, 400, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function main() {
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
    console.log(`  auth: ${TOKEN ? 'Bearer token required' : 'open (set ALLOWLATCH_HTTP_TOKEN)'}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
