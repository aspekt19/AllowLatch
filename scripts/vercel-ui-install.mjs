/**
 * Vercel install for UI + /api/copilot (SERV). Skip heavy AgentKit / OpenServ SDK.
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
        '@vercel/node': '^5.3.26',
        dotenv: '^17.4.2',
        openai: '^7.15.0',
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
