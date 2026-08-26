import { defineEventHandler, readBody, createError } from 'h3'
import { requireAuthenticatedUser } from '~~/server/utils/auth'

const MAX_PREFIX = 4000
const MAX_SUFFIX = 1000
const MAX_OUTPUT_TOKENS = 120
const REQUEST_TIMEOUT_MS = 9000
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000

function parseBody(input: unknown): { prefix: string, suffix: string } {
  if (!input || typeof input !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request body' })
  }

  const raw = input as Record<string, unknown>
  const prefix = typeof raw.prefix === 'string' ? raw.prefix.slice(0, MAX_PREFIX) : ''
  const suffix = typeof raw.suffix === 'string' ? raw.suffix.slice(0, MAX_SUFFIX) : ''

  if (prefix.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'prefix is required' })
  }

  return { prefix, suffix }
}

const SYSTEM_PROMPT = [
  'You are an inline autocomplete engine running inside a Markdown editor.',
  'Continue the user\'s document from exactly where the cursor sits.',
  'Rules:',
  '- Output ONLY the continuation text that directly follows the cursor.',
  '- Never repeat any part of the provided prefix or suffix.',
  '- Never add explanations, commentary, or markdown code fences around the output.',
  '- Match the existing language, tone, and Markdown formatting.',
  '- Keep it short: at most one or two sentences, or a few list items.',
  '- If there is nothing useful to add, respond with an empty string.'
].join('\n')

const userPrompt = (prefix: string, suffix: string) =>
  [
    '<document>',
    prefix,
    '<cursor/>',
    suffix,
    '</document>',
    '',
    'Write the text that comes immediately after <cursor/>. Reply with the continuation only.'
  ].join('\n')

interface CompletionProvider {
  complete(prefix: string, suffix: string): Promise<string>
}

function cleanSuggestion(raw: string): string {
  if (!raw) {
    return ''
  }

  let text = raw
  const fence = text.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/)
  if (fence) {
    text = fence[1]
  } else {
    text = text.replace(/^```[a-zA-Z0-9_-]*\r?\n?/, '').replace(/```$/m, '')
  }

  text = text.replace(/^\r?\n/, '').trimEnd()

  return text
}

function createGeminiProvider(apiKey: string, model: string): CompletionProvider {
  return {
    async complete(prefix, suffix) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt(prefix, suffix) }]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            stopSequences: ['\n\n\n'],
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw createError({
          statusCode: 502,
          message: `Gemini provider failed: ${response.status} ${detail.slice(0, 300)}`
        })
      }

      const data: any = await response.json()
      const parts: Array<{ text?: string }> = data?.candidates?.[0]?.content?.parts ?? []
      const joined = parts.map((part) => part.text ?? '').join('')

      return cleanSuggestion(joined)
    }
  }
}

function createNvidiaProvider(apiKey: string, model: string): CompletionProvider {
  return {
    async complete(prefix, suffix) {
      const url = 'https://integrate.api.nvidia.com/v1/chat/completions'

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt(prefix, suffix) }
          ],
          temperature: 0.3,
          max_tokens: MAX_OUTPUT_TOKENS,
          stop: ['\n\n\n']
        })
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw createError({
          statusCode: 502,
          message: `NVIDIA provider failed: ${response.status} ${detail.slice(0, 300)}`
        })
      }

      const data: any = await response.json()
      const content: string = data?.choices?.[0]?.message?.content ?? ''

      return cleanSuggestion(content)
    }
  }
}

const rateBuckets = new Map<string, number[]>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const hits = rateBuckets.get(userId)?.filter((t) => now - t < RATE_WINDOW_MS) ?? []
  hits.push(now)
  rateBuckets.set(userId, hits)
  return hits.length <= RATE_LIMIT
}

export default defineEventHandler(async (event) => {
  const user = await requireAuthenticatedUser(event)

  if (!checkRateLimit(user.id)) {
    throw createError({ statusCode: 429, statusMessage: 'Rate limit exceeded' })
  }

  const config = useRuntimeConfig(event)
  const provider = String(config.aiProvider || 'gemini').toLowerCase()

  const parsedBody = parseBody(await readBody(event))

  let client: CompletionProvider
  if (provider === 'nvidia') {
    if (!config.nvidiaApiKey) {
      throw createError({ statusCode: 500, statusMessage: 'NVIDIA provider selected but NUXT_NVIDIA_API_KEY is not configured' })
    }
    client = createNvidiaProvider(String(config.nvidiaApiKey), String(config.nvidiaModel))
  } else {
    if (!config.geminiApiKey) {
      throw createError({ statusCode: 500, statusMessage: 'Gemini provider selected but NUXT_GEMINI_API_KEY is not configured' })
    }
    client = createGeminiProvider(String(config.geminiApiKey), String(config.geminiModel))
  }

  try {
    const suggestion = await client.complete(parsedBody.prefix, parsedBody.suffix)
    return { suggestion }
  } catch (error) {
    if (import.meta.dev) {
      console.error('[ai/complete] provider error', error)
    }
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    throw createError({ statusCode: 502, statusMessage: 'AI completion request failed' })
  }
})
