#!/usr/bin/env node
/**
 * Point the OpenServ agent at an always-on public HTTPS host (Railway / Fly / Render).
 *
 * Usage:
 *   ALLOWLATCH_HOST_URL=https://your-host.example.com node scripts/point-openserv-endpoint.mjs
 *
 * Requires .openserv.json (agent id + apiKey) written by provision().
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { ApiClient } = require('@openserv-labs/client/dist/deploy/api-client.js')

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

async function main() {
  const raw = process.env.ALLOWLATCH_HOST_URL?.trim()
  if (!raw) {
    throw new Error('Set ALLOWLATCH_HOST_URL to the public HTTPS origin (no trailing path)')
  }
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('ALLOWLATCH_HOST_URL must be https')
  const endpointUrl = url.origin

  const osj = readJson(path.join(root, '.openserv.json'))
  const agent = osj?.agents?.allowlatch
  if (!agent?.id || !agent?.apiKey) {
    throw new Error('.openserv.json missing agents.allowlatch id/apiKey — run provision once')
  }

  const envText = fs.readFileSync(path.join(root, '.env'), 'utf8')
  const userKey = envText.match(/^OPENSERV_USER_API_KEY=(.+)$/m)?.[1]?.trim()
  if (!userKey) throw new Error('OPENSERV_USER_API_KEY missing in .env')

  const client = new ApiClient({ apiKey: userKey })
  await client.updateEndpointUrl(agent.id, agent.apiKey, endpointUrl)
  console.log('OpenServ agent endpoint →', endpointUrl)
  console.log('Next: deploy the Dockerfile host with DISABLE_TUNNEL=true to that URL, then check:')
  console.log('  curl -s https://allowlatch.vercel.app/api/host-info | jq .openserv.isActive')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
