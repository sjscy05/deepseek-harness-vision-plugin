/**
 * Unit tests for the `vision_read` tool: definition contract and end-to-end
 * execution with a mocked provider HTTP layer.
 * @module vision-plugin/tests/tool
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveProviderSettings } from '../src/index.ts'
import { defineVisionReadTool, truncateText } from '../src/tool.ts'
import { makeConfig, PNG_DATA_URI, PNG_SIG, PNG_SIG_B64, jsonResponse } from './helpers.ts'

const exec: ToolRunContext = {
  signal: new AbortController().signal,
  deferContext: () => {},
  concludeTurn: () => {},
} as unknown as ToolRunContext

function openaiOk(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] })
}

/** Stub global fetch with a typed mock whose calls can be inspected. */
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('truncateText', () => {
  it('passes short text through untouched', () => {
    expect(truncateText('short', 100)).toBe('short')
  })

  it('caps long text with a trailing marker', () => {
    const result = truncateText('a'.repeat(50), 10)
    expect(result.startsWith('a'.repeat(10))).toBe(true)
    expect(result).toContain('(truncated to 10 characters)')
  })
})

describe('defineVisionReadTool', () => {
  it('declares the tool contract from configuration', () => {
    const config = makeConfig({ timeoutMs: 42_000 })
    const tool = defineVisionReadTool(config)
    expect(tool.name).toBe('vision_read')
    expect(tool.description).toContain('Read an image')
    expect(tool.timeoutMs).toBe(42_000)
    expect(tool.output.schema).toEqual({ type: 'string' })
    // defineTool compiles the parameter spec to JSON Schema: required
    // properties are collected into a top-level `required` array.
    const params = tool.parameters as { required?: string[]; properties?: Record<string, unknown> }
    expect(params.required).toContain('image')
    expect(params.properties).toHaveProperty('question')
    expect(params.properties).toHaveProperty('model')
  })
})

describe('vision_read execution (openai provider)', () => {
  it('sends the image as a data-URI part and returns the answer', async () => {
    const fetchMock = stubFetch(async () => openaiOk('A red circle'))
    const tool = defineVisionReadTool(makeConfig())

    const result = await tool.execute({ image: PNG_DATA_URI, question: 'What color?' }, exec)

    expect(result).toBe('A red circle')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    const body = JSON.parse(init!.body as string) as {
      model: string
      messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>
    }
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages[0]!.content[0]).toMatchObject({ type: 'text', text: 'What color?' })
    expect(body.messages[0]!.content[1]!.image_url!.url).toBe(PNG_DATA_URI)
  })

  it('applies the configured default question when omitted', async () => {
    const fetchMock = stubFetch(async () => openaiOk('ok'))
    const tool = defineVisionReadTool(makeConfig({ defaultQuestion: 'List every visible word.' }))

    await tool.execute({ image: PNG_DATA_URI }, exec)

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      messages: Array<{ content: Array<{ text?: string }> }>
    }
    expect(body.messages[0]!.content[0]!.text).toBe('List every visible word.')
  })

  it('honors a per-call model override', async () => {
    const fetchMock = stubFetch(async () => openaiOk('ok'))
    const tool = defineVisionReadTool(makeConfig())

    await tool.execute({ image: PNG_DATA_URI, model: 'qwen-vl-max' }, exec)

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string }
    expect(body.model).toBe('qwen-vl-max')
  })

  it('reads a local file and sends its bytes as a data-URI part', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vision-plugin-tool-'))
    try {
      const file = path.join(dir, 'pic.png')
      await writeFile(file, PNG_SIG)
      const fetchMock = stubFetch(async () => openaiOk('ok'))
      const tool = defineVisionReadTool(makeConfig())

      await tool.execute({ image: file, question: 'What?' }, exec)

      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
        messages: Array<{ content: Array<{ image_url?: { url: string } }> }>
      }
      expect(body.messages[0]!.content[1]!.image_url!.url).toBe(`data:image/png;base64,${PNG_SIG_B64}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('truncates long answers to the configured cap', async () => {
    const longAnswer = 'word '.repeat(10_000)
    stubFetch(async () => openaiOk(longAnswer))
    const tool = defineVisionReadTool(makeConfig({ maxOutputChars: 100 }))

    const result = await tool.execute({ image: PNG_DATA_URI }, exec) as string

    expect(result.length).toBeLessThan(longAnswer.length)
    expect(result).toContain('(truncated to 100 characters)')
  })

  it('propagates provider HTTP errors with the provider message', async () => {
    stubFetch(async () => jsonResponse(
      { error: { message: 'invalid api key' } },
      401,
    ))
    const tool = defineVisionReadTool(makeConfig())

    await expect(tool.execute({ image: PNG_DATA_URI }, exec))
      .rejects.toThrow('vision provider error (HTTP 401): invalid api key')
  })
})

describe('resolveProviderSettings', () => {
  it('applies the default base URL for the selected provider', () => {
    const config = makeConfig({ provider: 'anthropic', anthropic: { apiKey: 'k', model: 'claude-x' } })
    delete config.openai
    expect(resolveProviderSettings(config)).toMatchObject({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'k',
      model: 'claude-x',
    })
  })

  it('fails loudly when the selected provider block is missing', () => {
    const config = makeConfig({ provider: 'gemini' })
    delete config.openai
    expect(() => resolveProviderSettings(config)).toThrow('settings block (gemini:) is missing')
  })

  it('fails loudly on an empty apiKey', () => {
    const config = makeConfig({ openai: { apiKey: '', model: 'gpt-4o-mini' } })
    expect(() => resolveProviderSettings(config)).toThrow('empty apiKey')
  })
})
