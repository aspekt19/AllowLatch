/**
 * Vercel UI-only install: skip AgentKit / OpenServ / CDP (heavy, unused by Vite UI).
 */
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

writeFileSync(
  'package.json',
  JSON.stringify(
    {
      name: 'spendgate-ui',
      private: true,
      type: 'module',
      dependencies: {
        vite: '^8.3.0',
        zod: '^3.25.67',
      },
    },
    null,
    2
  )
)

const r = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(r.status ?? 1)
