import OpenAI from 'openai'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const BASE_URL = 'https://inference-api.openserv.ai/v1'

export function getServClient() {
  const apiKey = process.env.SERV_API_KEY
  if (!apiKey) {
    throw new Error(
      'SERV_API_KEY is missing. Create a key at https://console.openserv.ai and set it in .env (Reasoning — not Platform).'
    )
  }
  return new OpenAI({
    baseURL: BASE_URL,
    apiKey,
  })
}

/**
 * SERV Reasoning chat completion (OpenAI-compatible).
 * Always sends a system prompt — required by SERV.
 */
export async function servChat(params: {
  system: string
  user: string
  model?: string
}): Promise<string> {
  const client = getServClient()
  const response = await client.chat.completions.create({
    model: params.model ?? process.env.SERV_MODEL ?? 'gpt-5.4-mini',
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
  })
  const text = response.choices[0]?.message?.content
  if (!text) throw new Error('Empty response from SERV Reasoning')
  return text
}

/** Structured JSON via SERV Reasoning + Zod schema. */
export async function servStructured<T extends z.ZodType>(params: {
  system: string
  user: string
  schema: T
  schemaName: string
  model?: string
}): Promise<z.infer<T>> {
  const client = getServClient()
  const response = await client.chat.completions.create({
    model: params.model ?? process.env.SERV_MODEL ?? 'gpt-5.4-mini',
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    response_format: zodResponseFormat(params.schema, params.schemaName),
  })
  const text = response.choices[0]?.message?.content
  if (!text) throw new Error('Empty structured response from SERV Reasoning')
  return params.schema.parse(JSON.parse(text))
}
