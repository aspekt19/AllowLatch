/**
 * SERV Reasoning client — OpenAI-compatible chat completions.
 * Docs: https://docs.openserv.ai/serv-reasoning/
 *
 * Day-one defaults (docs/serv-reasoning/day-one):
 * - smallest model that fits the task
 * - reasoning_effort: low (raise only when needed)
 * - system prompt required + versioned
 * - structured outputs when software consumes the result
 * - no tight max_tokens
 * - SERV Tools (serv_* ) for prompt guard / shadow agent
 */
import OpenAI from 'openai'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

export const SERV_BASE_URL = 'https://inference-api.openserv.ai/v1'

/** Catalog default — small + cheap; SERV improves reliability on smaller models. */
export const SERV_DEFAULT_MODEL = 'gpt-5.4-mini'

export type ServReasoningEffort = 'none' | 'low' | 'medium' | 'high'

export type ServToolsOptions = {
  /** Opt-in: block injection that tries to extract/override system prompt. */
  promptGuard?: boolean
  /** Opt-in: validate-and-revise loop for hard structured tasks. */
  shadowAgent?: {
    hint?: string
    maxIterations?: number
  }
}

export type ServUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type ServMeta = {
  model: string
  reasoningEffort?: ServReasoningEffort
  finishReason?: string | null
  usage?: ServUsage
  latencyMs: number
  promptVersion?: string
}

function resolveModel(model?: string): string {
  return model ?? process.env.SERV_MODEL ?? SERV_DEFAULT_MODEL
}

function resolveEffort(effort?: ServReasoningEffort): ServReasoningEffort {
  const raw = (effort ?? process.env.SERV_REASONING_EFFORT ?? 'low').toString()
  // SERV rejects OpenAI's "minimal"; map to "low"
  if (raw === 'minimal') return 'low'
  if (raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high') return raw
  return 'low'
}

/** Build OpenAI-format tools that SERV intercepts (never reach the model). */
export function buildServTools(opts: ServToolsOptions = {}): OpenAI.Chat.ChatCompletionTool[] {
  const tools: OpenAI.Chat.ChatCompletionTool[] = []

  if (opts.promptGuard) {
    tools.push({
      type: 'function',
      function: { name: 'serv_prompt_guard' },
    })
  }

  if (opts.shadowAgent) {
    const properties: Record<string, unknown> = {}
    if (opts.shadowAgent.hint) {
      properties.hint = { type: 'string', default: opts.shadowAgent.hint }
    }
    if (opts.shadowAgent.maxIterations != null) {
      properties.max_iterations = {
        type: 'integer',
        default: opts.shadowAgent.maxIterations,
      }
    }
    tools.push({
      type: 'function',
      function: {
        name: 'serv_shadow_agent',
        description: 'Enable SERV shadow-agent validation.',
        ...(Object.keys(properties).length
          ? { parameters: { type: 'object', properties } }
          : {}),
      },
    })
  }

  return tools
}

export function getServClient() {
  const apiKey = process.env.SERV_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      'SERV_API_KEY is missing. Create a key at https://console.openserv.ai and set it in .env (Reasoning — not Platform).'
    )
  }
  if ([...apiKey].some((c) => c.charCodeAt(0) > 127)) {
    throw new Error('SERV_API_KEY contains non-ASCII characters — check Vercel/env value for corruption.')
  }
  return new OpenAI({
    baseURL: SERV_BASE_URL,
    apiKey,
  })
}

function usageFromResponse(response: OpenAI.Chat.ChatCompletion): ServUsage | undefined {
  const u = response.usage
  if (!u) return undefined
  return {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    totalTokens: u.total_tokens,
  }
}

function logMeta(label: string, meta: ServMeta) {
  if (process.env.SERV_LOG !== '0') {
    const parts = [
      `[serv] ${label}`,
      `model=${meta.model}`,
      meta.reasoningEffort ? `effort=${meta.reasoningEffort}` : null,
      meta.promptVersion ? `prompt=${meta.promptVersion}` : null,
      `${meta.latencyMs}ms`,
      meta.usage?.totalTokens != null ? `tokens=${meta.usage.totalTokens}` : null,
      meta.finishReason ? `finish=${meta.finishReason}` : null,
    ].filter(Boolean)
    console.error(parts.join(' '))
  }
}

/**
 * SERV Reasoning chat completion (OpenAI-compatible).
 * Always sends a system prompt — required by SERV.
 */
export async function servChat(params: {
  system: string
  user: string
  model?: string
  reasoningEffort?: ServReasoningEffort
  servTools?: ServToolsOptions
  promptVersion?: string
}): Promise<{ text: string; meta: ServMeta }> {
  const client = getServClient()
  const model = resolveModel(params.model)
  const reasoningEffort = resolveEffort(params.reasoningEffort)
  const tools = buildServTools(params.servTools ?? {})

  const started = Date.now()
  const response = await client.chat.completions.create({
    model,
    reasoning_effort: reasoningEffort,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    ...(tools.length ? { tools } : {}),
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)

  const text = response.choices[0]?.message?.content
  if (!text) throw new Error('Empty response from SERV Reasoning')

  const meta: ServMeta = {
    model: response.model ?? model,
    reasoningEffort,
    finishReason: response.choices[0]?.finish_reason,
    usage: usageFromResponse(response),
    latencyMs: Date.now() - started,
    promptVersion: params.promptVersion,
  }
  logMeta('chat', meta)
  return { text, meta }
}

/** Structured JSON via SERV Reasoning + Zod schema (validated application-side). */
export async function servStructured<T extends z.ZodType>(params: {
  system: string
  user: string
  schema: T
  schemaName: string
  model?: string
  reasoningEffort?: ServReasoningEffort
  servTools?: ServToolsOptions
  promptVersion?: string
}): Promise<{ data: z.infer<T>; meta: ServMeta }> {
  const client = getServClient()
  const model = resolveModel(params.model)
  const reasoningEffort = resolveEffort(params.reasoningEffort)
  const tools = buildServTools(params.servTools ?? {})

  const started = Date.now()
  const response = await client.chat.completions.create({
    model,
    reasoning_effort: reasoningEffort,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    response_format: zodResponseFormat(params.schema, params.schemaName),
    ...(tools.length ? { tools } : {}),
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)

  const choice = response.choices[0]
  const finishReason = choice?.finish_reason
  const refusal = (choice?.message as { refusal?: string | null } | undefined)?.refusal
  if (finishReason === 'length') {
    throw new Error('SERV Reasoning response truncated (finish_reason=length)')
  }
  if (finishReason === 'content_filter') {
    throw new Error('SERV Reasoning blocked by content filter')
  }
  if (refusal) {
    throw new Error(`SERV Reasoning refused: ${refusal}`)
  }

  const text = choice?.message?.content
  if (!text) {
    throw new Error(
      `Empty structured response from SERV Reasoning (finish_reason=${finishReason ?? 'unknown'})`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('SERV Reasoning returned non-JSON structured content')
  }

  const data = params.schema.parse(parsed)
  const meta: ServMeta = {
    model: response.model ?? model,
    reasoningEffort,
    finishReason,
    usage: usageFromResponse(response),
    latencyMs: Date.now() - started,
    promptVersion: params.promptVersion,
  }
  logMeta(`structured:${params.schemaName}`, meta)
  return { data, meta }
}
