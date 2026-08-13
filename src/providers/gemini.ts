/**
 * Google Gemini generateContent provider. Images travel as `inline_data`
 * parts; the model id is part of the URL path.
 * @module vision-plugin/providers/gemini
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { ProviderCall, ProviderSettings, VisionInput, VisionProvider } from './types.ts'

/** The Gemini generateContent vision provider implementation. */
export const geminiProvider: VisionProvider = {
  key: 'gemini',
  displayName: 'Gemini',

  buildRequest(settings: ProviderSettings, input: VisionInput): ProviderCall {
    return {
      url: `${settings.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(settings.model)}:generateContent`,
      headers: {
        'x-goog-api-key': settings.apiKey,
        ...attributionHeaders(),
      },
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              {
                inline_data: {
                  mime_type: input.mimeType,
                  data: input.base64,
                },
              },
              { text: input.question },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: settings.maxTokens,
        },
      },
    }
  },

  parseResponse(data: unknown): string {
    const root = asRecord(data, 'response')
    const candidates = asArray(root.candidates, 'response.candidates')
    const first = candidates[0]
    if (first === undefined) {
      const blockReason = root.promptFeedback === undefined
        ? undefined
        : asRecord(root.promptFeedback, 'response.promptFeedback').blockReason
      if (typeof blockReason === 'string') {
        throw new Error(`request blocked by safety filters: ${blockReason}`)
      }
      throw new Error('response contained no candidates')
    }
    const content = asRecord(first, 'response.candidates[0]').content
    if (content === undefined) {
      throw new Error('response candidates[0] contained no content')
    }
    const parts = asArray(asRecord(content, 'response.candidates[0].content').parts, 'response.candidates[0].content.parts')
    const text = parts
      .map(part => asRecord(part, 'response.candidates[0].content.parts[]'))
      .filter(part => typeof part.text === 'string')
      .map(part => part.text as string)
      .join('')
    if (text.length === 0) {
      throw new Error('response contained no text content')
    }
    return text
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
