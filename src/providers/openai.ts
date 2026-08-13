/**
 * OpenAI-compatible chat-completions provider. Covers OpenAI (`gpt-4o` /
 * `gpt-4o-mini` / `gpt-4.1`) and every OpenAI-compatible gateway that speaks
 * the same wire format (Qwen-VL via DashScope compatible mode, Zhipu GLM-4V,
 * Moonshot, Mistral, xAI, local vLLM/Ollama endpoints, …), selected by a
 * configurable `baseUrl`.
 * @module vision-plugin/providers/openai
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { ProviderCall, ProviderSettings, VisionInput, VisionProvider } from './types.ts'

/** Strip one trailing slash so `baseUrl` and the route join cleanly. */
function route(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${suffix}`
}

/** The OpenAI-compatible vision provider implementation. */
export const openaiProvider: VisionProvider = {
  key: 'openai',
  displayName: 'OpenAI-compatible',

  buildRequest(settings: ProviderSettings, input: VisionInput): ProviderCall {
    return {
      url: route(settings.baseUrl, '/chat/completions'),
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        ...attributionHeaders(),
      },
      body: {
        model: settings.model,
        max_tokens: settings.maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: input.question },
              {
                type: 'image_url',
                image_url: { url: `data:${input.mimeType};base64,${input.base64}` },
              },
            ],
          },
        ],
      },
    }
  },

  parseResponse(data: unknown): string {
    const root = asRecord(data, 'response')
    const choices = asArray(root.choices, 'response.choices')
    const first = choices[0]
    if (first === undefined) {
      throw new Error('response contained no choices')
    }
    const message = asRecord(first, 'response.choices[0]').message
    const content = message === undefined ? undefined : asRecord(message, 'response.choices[0].message').content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const parts = content
        .map(part => asRecord(part, 'response.choices[0].message.content[]'))
        .filter(part => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text as string)
      if (parts.length > 0) return parts.join('')
    }
    throw new Error('response contained no text content')
  },
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error(`${where} is not a JSON object`)
}

function asArray(value: unknown, where: string): unknown[] {
  if (Array.isArray(value)) return value
  throw new Error(`${where} is not a JSON array`)
}
