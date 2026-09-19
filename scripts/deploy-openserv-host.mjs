#!/usr/bin/env node
/**
 * Always-on OpenServ host without using the broken upload API.
 * Clones from GitHub (slim deps, no AgentKit), injects secrets, npm install, go-live.
 *
 *   node scripts/deploy-openserv-host.mjs
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

async function main() {
  let envText = readEnv()
  const apiKey = get(envText, 'OPENSERV_USER_API_KEY')
  if (!apiKey) throw new Error('OPENSERV_USER_API_KEY missing')
  const client = new ApiClient({ apiKey })

  let id = get(envText, 'OPENSERV_CONTAINER_ID')
  // Prefer a fresh container if prior ones are disk-full
  console.log('Creating fresh container…')
  const c = await client.createContainer()
  id = c.id
  envText = set(envText, 'OPENSERV_CONTAINER_ID', id)
  if (!get(envText, 'ALLOWLATCH_EXECUTE_MODE')) {
    envText = set(envText, 'ALLOWLATCH_EXECUTE_MODE', 'dry-run')
  }
  fs.writeFileSync(path.join(root, '.env'), envText)
  console.log('Container', id)

  async function sh(script, timeoutSec = 120) {
    const r = await client.exec(id, ['bash', '-lc', script], timeoutSec)
    if (r.stdout?.trim()) console.log(r.stdout.trim().slice(0, 1200))
    if (r.stderr?.trim()) console.log('stderr:', r.stderr.trim().slice(0, 400))
    if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}`)
    return r
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

  // secrets in small pieces via base64 (env is tiny)
  // Ensure tenant auth on hosted container
  let envLocal = fs.readFileSync(path.join(root, '.env'), 'utf8')
  if (!/^ALLOWLATCH_TENANT_AUTH=/m.test(envLocal)) {
    envLocal += '\nALLOWLATCH_TENANT_AUTH=1\n'
    fs.writeFileSync(path.join(root, '.env'), envLocal)
  }
  const envB64Final = Buffer.from(envLocal).toString('base64')
  const osB64 = Buffer.from(fs.readFileSync(path.join(root, '.openserv.json'))).toString('base64')
  console.log('Writing secrets…')
  await sh(
    `printf '%s' '${envB64Final}' | base64 -d > /app/.env && printf '%s' '${osB64}' | base64 -d > /app/.openserv.json && wc -c /app/.env /app/.openserv.json`,
    90
  )

  console.log('npm install (background)…')
  await sh(`cd /app && nohup npm install --legacy-peer-deps > /tmp/npm.log 2>&1 & echo $!`, 30)

  let ok = false
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10000))
    const p = await sh(
      `if pgrep -f "npm install" >/dev/null 2>&1; then echo RUNNING; tail -2 /tmp/npm.log
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
  await client.start(id, 'npx tsx src/agent.ts')
  const live = await client.goLive(id, 'continuous')
  console.log('LIVE', live)

  // probe discover
  const { PlatformClient } = await import('@openserv-labs/client')
  const pc = new PlatformClient()
  const services = await pc.payments.discoverServices()
  const hit = services.find((s) => /allowlatch/i.test(s.name || ''))
  console.log('discover', { name: hit?.name, isActive: hit?.isActive, price: hit?.x402Pricing })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
