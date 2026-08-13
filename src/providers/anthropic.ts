/**
 * Anthropic Messages API provider (Claude vision models). Images travel as
 * base64 `image` content blocks, which is the only form the Anthropic API
 * accepts (remote URLs are not supported upstream).
 * @module vision-plugin/providers/anthropic
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { ProviderCall, ProviderSettings, VisionInput, VisionProvider } from './types.ts'

/** Wire version pinned by the Messages API contract. */
const ANTHROPIC_VERSION = '2023-06-01'

/** The Anthropic Messages API vision provider implementation. */
export const anthropicProvider: VisionProvider = {
  key: 'anthropic',
  displayName: 'Anthropic',

  buildRequest(settings: ProviderSettings, input: VisionInput): ProviderCall {
    return {
      url: `${settings.baseUrl.replace(/\/+$/, '')}/v1/messages`,
      headers: {
        'x-api-key': settings.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        ...attributionHeaders(),
      },
      body: {
        model: settings.model,
        max_tokens: settings.maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: input.mimeType,
                  data: input.base64,
                },
              },
              { type: 'text', text: input.question },
            ],
          },
        ],
      },
    }
  },

  parseResponse(data: unknown): string {
    const root = asRecord(data, 'response')
    const content = asArray(root.content, 'response.content')
    const parts = content
      .map(block => asRecord(block, 'response.content[]'))
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
    if (parts.length === 0) {
      throw new Error('response contained no text content')
    }
    return parts.join('')
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
