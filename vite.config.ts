import { defineConfig, type Plugin, type Connect } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const rootDir = path.dirname(fileURLToPath(import.meta.url))

function readJson(req: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function copilotApiPlugin(): Plugin {
  return {
    name: 'allowlatch-copilot-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/host-info') && req.method === 'GET') {
          const { getHostInfo } = await import('./api/host-info-data.ts')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(getHostInfo()))
          return
        }
        if (!req.url?.startsWith('/api/copilot') || req.method !== 'POST') {
          next()
          return
        }
        try {
          const body = await readJson(req)
          const { handleCopilotBody } = await import('./api/copilot-handler.ts')
          const { status, json } = await handleCopilotBody(body)
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(json))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          )
        }
      })
    },
  }
}

export default defineConfig({
  root: 'web',
  plugins: [copilotApiPlugin()],
  resolve: {
    alias: {
      '@policy': path.resolve(rootDir, 'src/policy'),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: path.resolve(rootDir, 'web-dist'),
    emptyOutDir: true,
  },
})
