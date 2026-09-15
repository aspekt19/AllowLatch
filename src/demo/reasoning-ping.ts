/**
 * Smoke-test SERV Reasoning with SERV_API_KEY from .env
 */
import dotenv from 'dotenv'
dotenv.config()

import { servChat } from '../llm/serv-reasoning.js'

async function main() {
  const text = await servChat({
    system: 'You are a concise assistant for SpendGate.',
    user: 'Reply with exactly: SERV Reasoning OK',
  })
  console.log(text)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
