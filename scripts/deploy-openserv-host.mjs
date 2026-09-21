#!/usr/bin/env node
/**
 * Always-on OpenServ host (slim clone, no AgentKit).
 * Retries Cloudflare 502s; reuses OPENSERV_CONTAINER_ID when healthy.
 *
 *   npm run deploy:host
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { ApiClient } = require('@openserv-labs/client/dist/deploy/api-client.js')

function readEnv() {
  return fs.readFileSync(path.join(root, '.env'), 'utf8')
}
function get(text, key) {
  return text.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
}
function set(text, key, value) {
  const line = `${key}=${value}`
  return new RegExp(`^${key}=`, 'm').test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${text.replace(/\s*$/, '')}\n${line}\n`
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withRetry(label, fn, { attempts = 6, baseMs = 15_000 } = {}) {
  let last
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const code = e?.statusCode || e?.status
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`${label} attempt ${i}/${attempts} failed`, code || msg.slice(0, 160))
      if (i === attempts) break
      const wait = baseMs * i
      console.log(`retry in ${Math.round(wait / 1000)}s…`)
      await sleep(wait)
    }
  }
  throw last
}

async function main() {
  let envText = readEnv()
  const apiKey = get(envText, 'OPENSERV_USER_API_KEY')
  if (!apiKey) throw new Error('OPENSERV_USER_API_KEY missing')
  const client = new ApiClient({ apiKey })

  let id = get(envText, 'OPENSERV_CONTAINER_ID')
  const forceFresh = process.env.ALLOWLATCH_FORCE_FRESH_CONTAINER === '1'

  if (id && !forceFresh) {
    try {
      const st = await withRetry('getStatus', () => client.getStatus(id), {
        attempts: 3,
        baseMs: 8_000,
      })
      console.log('Reusing container', id, st?.status || st?.machineState || '')
    } catch {
      console.log('Existing container unreachable — creating fresh…')
      id = null
    }
  }

  if (!id || forceFresh) {
    console.log('Creating fresh container…')
    const c = await withRetry('createContainer', () => client.createContainer())
    id = c.id
    envText = set(envText, 'OPENSERV_CONTAINER_ID', id)
    if (!get(envText, 'ALLOWLATCH_EXECUTE_MODE')) {
      envText = set(envText, 'ALLOWLATCH_EXECUTE_MODE', 'dry-run')
    }
    fs.writeFileSync(path.join(root, '.env'), envText)
    console.log('Container', id)
  }

  async function sh(script, timeoutSec = 120) {
    return withRetry(
      'exec',
      async () => {
        const r = await client.exec(id, ['bash', '-lc', script], timeoutSec)
        if (r.stdout?.trim()) console.log(r.stdout.trim().slice(0, 1200))
        if (r.stderr?.trim()) console.log('stderr:', r.stderr.trim().slice(0, 400))
        if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}`)
        return r
      },
      { attempts: 6, baseMs: 12_000 }
    )
  }

  console.log('Bootstrap apt + git clone…')
  await sh(
    `set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git ca-certificates >/dev/null
cd /app
rm -rf src .git repo node_modules package.json package-lock.json
git clone --depth 1 https://github.com/aspekt19/AllowLatch.git repo
cp -a repo/src .
cp repo/tsconfig.json .
rm -rf repo
cat > package.json <<'EOF'
{
  "name": "allowlatch",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@openserv-labs/client": "^2.5.3",
    "@openserv-labs/sdk": "^2.4.1",
    "dotenv": "^17.4.2",
    "openai": "^7.15.0",
    "zod": "^3.25.67"
  },
  "devDependencies": {
    "tsx": "^4.23.13",
    "typescript": "^7.0.2",
    "@types/node": "^26.6.0"
  }
}
EOF
df -h /app
ls src | head
`,
    300
  )

  let envLocal = fs.readFileSync(path.join(root, '.env'), 'utf8')
  if (!/^ALLOWLATCH_TENANT_AUTH=/m.test(envLocal)) {
    envLocal += '\nALLOWLATCH_TENANT_AUTH=1\n'
    fs.writeFileSync(path.join(root, '.env'), envLocal)
  }
  const envB64Final = Buffer.from(envLocal).toString('base64')
  const osB64 = Buffer.from(fs.readFileSync(path.join(root, '.openserv.json'))).toString(
    'base64'
  )
  console.log('Writing secrets…')
  await sh(
    `printf '%s' '${envB64Final}' | base64 -d > /app/.env && printf '%s' '${osB64}' | base64 -d > /app/.openserv.json && wc -c /app/.env /app/.openserv.json`,
    90
  )

  console.log('npm install (background)…')
  await sh(`cd /app && nohup npm install --legacy-peer-deps > /tmp/npm.log 2>&1 & echo $!`, 30)

  let ok = false
  for (let i = 0; i < 60; i++) {
    await sleep(10_000)
    const p = await sh(
      `if ps aux 2>/dev/null | grep -v grep | grep -q "npm install"; then echo RUNNING; tail -2 /tmp/npm.log
elif test -x /app/node_modules/.bin/tsx && test -d /app/node_modules/@openserv-labs/sdk; then echo DONE; df -h /app; tail -8 /tmp/npm.log
else echo WAIT; tail -12 /tmp/npm.log; fi`,
      90
    )
    const out = p.stdout || ''
    console.log(`[${i}] ${out.trim().slice(0, 350)}`)
    if (out.includes('DONE')) {
      ok = true
      break
    }
    if (out.includes('ENOSPC')) throw new Error('ENOSPC')
  }
  if (!ok) throw new Error('npm install did not finish')

  console.log('start + go-live…')
  await withRetry('start', () => client.start(id, 'npx tsx src/agent.ts'))
  const live = await withRetry('goLive', () => client.goLive(id, 'continuous'))
  console.log('LIVE', live)

  const { PlatformClient } = await import('@openserv-labs/client')
  const pc = new PlatformClient()
  const services = await pc.payments.discoverServices()
  const hit = services.find((s) => /allowlatch/i.test(s.name || ''))
  console.log('discover', { name: hit?.name, isActive: hit?.isActive, price: hit?.x402Pricing })
  console.log('Done. Keep this container running — paid x402 needs it.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
