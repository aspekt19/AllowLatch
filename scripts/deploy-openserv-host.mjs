#!/usr/bin/env node
/**
 * Operator: deploy slim always-on AllowLatch host to OpenServ Cloud.
 * Bypasses broken orchestrator upload by git-clone + exec; excludes AgentKit from install.
 *
 *   OPENSERV_USER_API_KEY=… node scripts/deploy-openserv-host.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const { ApiClient } = require('@openserv-labs/client/dist/deploy/api-client.js')

function readEnvFile() {
  return fs.readFileSync(path.join(root, '.env'), 'utf8')
}

function envGet(text, key) {
  return text.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
}

function envSet(text, key, value) {
  const line = `${key}=${value}`
  if (new RegExp(`^${key}=`, 'm').test(text)) {
    return text.replace(new RegExp(`^${key}=.*$`, 'm'), line)
  }
  return `${text.replace(/\s*$/, '')}\n${line}\n`
}

async function main() {
  let envText = readEnvFile()
  const apiKey = envGet(envText, 'OPENSERV_USER_API_KEY')
  if (!apiKey) throw new Error('Set OPENSERV_USER_API_KEY in .env')

  const client = new ApiClient({ apiKey })
  let id = envGet(envText, 'OPENSERV_CONTAINER_ID')
  if (!id) {
    console.log('Creating container…')
    const c = await client.createContainer()
    id = c.id
    envText = envSet(envText, 'OPENSERV_CONTAINER_ID', id)
    fs.writeFileSync(path.join(root, '.env'), envText)
  }
  console.log('Container', id)

  async function sh(script, timeout = 120) {
    const r = await client.exec(id, ['bash', '-lc', script], timeout)
    if (r.stdout?.trim()) console.log(r.stdout.trim().slice(0, 1500))
    if (r.stderr?.trim()) console.log('stderr:', r.stderr.trim().slice(0, 600))
    if (r.exitCode !== 0) throw new Error(`exec exit ${r.exitCode}`)
    return r
  }

  console.log('Installing git + cloning slim tree…')
  await sh(
    `set -e
apt-get update -qq && apt-get install -y -qq git ca-certificates >/dev/null
cd /app
rm -rf src package.json tsconfig.json .git repo
git clone --depth 1 https://github.com/aspekt19/AllowLatch.git repo
cp -a repo/src /app/src
cp repo/tsconfig.json /app/tsconfig.json
rm -rf repo
cat > /app/package.json <<'EOF'
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
`,
    180
  )

  const envB64 = Buffer.from(fs.readFileSync(path.join(root, '.env'))).toString('base64')
  const osB64 = Buffer.from(fs.readFileSync(path.join(root, '.openserv.json'))).toString('base64')
  console.log('Writing secrets…')
  await sh(
    `printf '%s' '${envB64}' | base64 -d > /app/.env && printf '%s' '${osB64}' | base64 -d > /app/.openserv.json && echo secrets_ok`,
    60
  )

  console.log('npm install (background)…')
  await sh(
    `cd /app && rm -rf node_modules && nohup npm install --legacy-peer-deps > /tmp/npm.log 2>&1 & echo started`,
    30
  )

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10000))
    const p = await sh(
      `if pgrep -f "npm install" >/dev/null; then echo RUNNING; tail -3 /tmp/npm.log; elif test -x /app/node_modules/.bin/tsx; then echo DONE; tail -8 /tmp/npm.log; df -h /app; else echo WAIT; tail -8 /tmp/npm.log; fi`,
      60
    )
    const out = p.stdout || ''
    console.log(`[${i}]`, out.trim().slice(0, 300))
    if (out.includes('DONE')) break
    if (out.includes('ENOSPC')) throw new Error('disk full during npm install')
  }

  console.log('Starting agent + go-live…')
  await client.start(id, 'npx tsx src/agent.ts')
  const live = await client.goLive(id, 'continuous')
  console.log('LIVE', live)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
