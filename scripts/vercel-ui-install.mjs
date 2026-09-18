/**
 * Vercel install for UI + /api/copilot (SERV). Skip heavy AgentKit / OpenServ SDK.
 */
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

writeFileSync(
  'package.json',
  JSON.stringify(
    {
      name: 'allowlatch-ui',
      private: true,
      type: 'module',
      dependencies: {
        '@fontsource-variable/geist': '^5.3.0',
        '@fontsource-variable/geist-mono': '^5.3.0',
        '@fontsource/instrument-serif': '^5.3.0',
        '@vercel/analytics': '^2.0.1',
        '@vercel/node': '^5.3.26',
        dotenv: '^17.4.2',
        openai: '^7.15.0',
        vite: '^8.3.0',
        zod: '^3.25.67',
      },
      devDependencies: {
        '@types/node': '^22.15.0',
        typescript: '^5.9.3',
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
