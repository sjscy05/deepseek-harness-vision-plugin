/**
 * Unit tests for the three provider families: wire request construction,
 * response parsing, HTTP error mapping, and the shared invocation wrapper.
 * @module vision-plugin/tests/providers
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { postJson } from '../src/http.ts'
import { anthropicProvider } from '../src/providers/anthropic.ts'
import { geminiProvider } from '../src/providers/gemini.ts'
import { openaiProvider } from '../src/providers/openai.ts'
import { invokeVision } from '../src/providers.ts'
import type { ProviderSettings } from '../src/providers/types.ts'
import { PNG_SIG_B64, jsonResponse } from './helpers.ts'

const SETTINGS: ProviderSettings = {
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'secret-key',
  model: 'vision-model',
  maxTokens: 512,
}

const INPUT = { question: 'What is in this image?', mimeType: 'image/png', base64: PNG_SIG_B64 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openaiProvider (OpenAI-compatible)', () => {
  it('builds a chat-completions request with the image as a data-URI part', () => {
    const call = openaiProvider.buildRequest(SETTINGS, INPUT)
    expect(call.url).toBe('https://api.example.com/v1/chat/completions')
    expect(call.headers.authorization).toBe('Bearer secret-key')
    expect(call.headers['user-agent']).toContain('deepseek-harness')
    const body = call.body as Record<string, unknown>
    expect(body.model).toBe('vision-model')
    expect(body.max_tokens).toBe(512)
    const content = (body.messages as Array<Record<string, unknown>>)[0]!.content as Array<Record<string, unknown>>
    expect(content[0]).toEqual({ type: 'text', text: INPUT.question })
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${PNG_SIG_B64}` },
    })
  })

  it('parses string content', () => {
    expect(openaiProvider.parseResponse({
      choices: [{ message: { content: 'A red circle' } }],
    })).toBe('A red circle')
  })

  it('parses array content and joins text parts', () => {
    expect(openaiProvider.parseResponse({
      choices: [{ message: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } }],
    })).toBe('AB')
  })

  it('rejects empty choices', () => {
    expect(() => openaiProvider.parseResponse({ choices: [] })).toThrow('no choices')
  })

  it('rejects content without text', () => {
    expect(() => openaiProvider.parseResponse({
      choices: [{ message: { content: [{ type: 'refusal', text: 'nope' }] } }],
    })).toThrow('no text content')
  })
})

describe('anthropicProvider', () => {
  it('builds a Messages API request with a base64 image source', () => {
    // The Anthropic base URL is the API root: /v1/messages is appended.
    const call = anthropicProvider.buildRequest({ ...SETTINGS, baseUrl: 'https://api.example.com' }, INPUT)
    expect(call.url).toBe('https://api.example.com/v1/messages')
    expect(call.headers['x-api-key']).toBe('secret-key')
    expect(call.headers['anthropic-version']).toBe('2023-06-01')
    const body = call.body as Record<string, unknown>
    expect(body.model).toBe('vision-model')
    expect(body.max_tokens).toBe(512)
    const content = (body.messages as Array<Record<string, unknown>>)[0]!.content as Array<Record<string, unknown>>
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG_SIG_B64 },
    })
    expect(content[1]).toEqual({ type: 'text', text: INPUT.question })
  })

  it('parses text blocks and skips non-text blocks', () => {
    expect(anthropicProvider.parseResponse({
      content: [
        { type: 'text', text: 'First.' },
        { type: 'tool_use', id: 'x', name: 'y', input: {} },
        { type: 'text', text: ' Second.' },
      ],
    })).toBe('First. Second.')
  })

  it('rejects responses without text blocks', () => {
    expect(() => anthropicProvider.parseResponse({ content: [] })).toThrow('no text content')
  })
})

describe('geminiProvider', () => {
  it('builds a generateContent request with the model in the URL', () => {
    const call = geminiProvider.buildRequest(SETTINGS, INPUT)
    expect(call.url).toBe('https://api.example.com/v1/models/vision-model:generateContent')
    expect(call.headers['x-goog-api-key']).toBe('secret-key')
    const body = call.body as Record<string, unknown>
    const parts = (body.contents as Array<Record<string, unknown>>)[0]!.parts as Array<Record<string, unknown>>
    expect(parts[0]).toEqual({
      inline_data: { mime_type: 'image/png', data: PNG_SIG_B64 },
    })
    expect(parts[1]).toEqual({ text: INPUT.question })
    expect((body.generationConfig as Record<string, unknown>).maxOutputTokens).toBe(512)
  })

  it('joins text parts across candidates', () => {
    expect(geminiProvider.parseResponse({
      candidates: [{ content: { parts: [{ text: 'A' }, { text: 'B' }] } }],
    })).toBe('AB')
  })

  it('rejects responses without candidates', () => {
    expect(() => geminiProvider.parseResponse({ candidates: [] })).toThrow('no candidates')
  })

  it('reports safety-filter blocks', () => {
    expect(() => geminiProvider.parseResponse({
      candidates: [],
      promptFeedback: { blockReason: 'SAFETY' },
    })).toThrow('blocked by safety filters: SAFETY')
  })
})

describe('postJson', () => {
  it('returns the parsed JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    await expect(postJson({
      url: 'https://api.example.com/x',
      headers: { authorization: 'Bearer k' },
      body: { a: 1 },
      timeoutMs: 1000,
    })).resolves.toEqual({ ok: true })
  })

  it('maps provider error bodies to ProviderHttpError with status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { message: 'invalid api key' } },
      401,
    )))
    const error = await postJson({
      url: 'https://api.example.com/x',
      headers: {},
      body: {},
      timeoutMs: 1000,
    }).catch((caught: unknown) => caught as Error & { status?: number; providerMessage?: string })
    expect(error).toBeInstanceOf(Error)
    expect((error as { message: string }).message).toContain('HTTP 401')
    expect((error as { message: string }).message).toContain('invalid api key')
    expect((error as { status: number }).status).toBe(401)
    expect((error as { providerMessage: string }).providerMessage).toBe('invalid api key')
  })

  it('falls back to the raw body when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway exploded', { status: 502 })))
    await expect(postJson({
      url: 'https://api.example.com/x',
      headers: {},
      body: {},
      timeoutMs: 1000,
    })).rejects.toThrow('gateway exploded')
  })

  it('times out with a named budget', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
      })
    })))
    await expect(postJson({
      url: 'https://api.example.com/x',
      headers: {},
      body: {},
      timeoutMs: 10,
    })).rejects.toThrow('timed out after 10 ms')
  })

  it('forwards caller cancellation without converting it', async () => {
    // An already-aborted signal never fires abort listeners, so the mock must
    // reject immediately in that state, like the real fetch does.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      const rejectWithReason = () => {
        const reason = signal?.reason
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      }
      if (signal?.aborted) {
        rejectWithReason()
        return
      }
      signal?.addEventListener('abort', rejectWithReason)
    })))
    const controller = new AbortController()
    controller.abort(new Error('caller cancelled'))
    await expect(postJson({
      url: 'https://api.example.com/x',
      headers: {},
      body: {},
      timeoutMs: 1000,
      signal: controller.signal,
    })).rejects.toThrow('caller cancelled')
  })
})

describe('invokeVision', () => {
  it('wraps parse failures with the provider display name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [] })))
    await expect(invokeVision(openaiProvider, SETTINGS, INPUT, { timeoutMs: 1000 }))
      .rejects.toThrow('OpenAI-compatible response parse failed')
  })

  it('returns the parsed answer for a successful call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      choices: [{ message: { content: 'A red circle' } }],
    })))
    await expect(invokeVision(openaiProvider, SETTINGS, INPUT, { timeoutMs: 1000 }))
      .resolves.toBe('A red circle')
  })
})
