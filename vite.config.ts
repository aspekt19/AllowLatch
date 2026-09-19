import { defineConfig, type Plugin, type Connect } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const rootDir = path.dirname(fileURLToPath(import.meta.url))

function readJson(req: Connect.IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c) => {
      const buf = Buffer.from(c)
      total += buf.length
      if (total > maxBytes) {
        reject(new Error(`Request body too large (max ${maxBytes} bytes)`))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
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
          const { getHostInfoAsync } = await import('./src/web/host-info-data.ts')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(await getHostInfoAsync()))
          return
        }
        if (!req.url?.startsWith('/api/copilot') || req.method !== 'POST') {
          next()
          return
        }
        try {
          const body = await readJson(req)
          const { checkBodySize, checkRateLimit, clientIp } = await import('./src/http/abuse-guard.ts')
          const ip = clientIp({
            headers: req.headers as Record<string, unknown>,
            socket: req.socket,
          })
          const rate = checkRateLimit(`copilot:${ip}`)
          if (!rate.ok) {
            res.statusCode = rate.status
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Retry-After', '60')
            res.end(JSON.stringify({ ok: false, error: rate.error }))
            return
          }
          const size = checkBodySize(body)
          if (!size.ok) {
            res.statusCode = size.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: size.error }))
            return
          }
          const { handleCopilotBody } = await import('./src/web/copilot-handler.ts')
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
