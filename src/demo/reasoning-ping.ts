/**
 * Smoke-test SERV Reasoning with SERV_API_KEY from .env
 */
import dotenv from 'dotenv'
dotenv.config()

import { servChat } from '../llm/serv-reasoning.js'

async function main() {
  const { text, meta } = await servChat({
    system: 'You are a concise assistant for AllowLatch.',
    user: 'Reply with exactly: SERV Reasoning OK',
    reasoningEffort: 'low',
  })
  console.log(text)
  console.error(`[serv] ping model=${meta.model} ${meta.latencyMs}ms`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
