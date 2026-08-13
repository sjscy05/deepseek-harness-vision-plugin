/**
 * In-process composition test: boots the real Cordis context with the
 * `tools` service (plus its `systemPrompt` dependency) and the plugin's
 * `apply`, then asserts the `vision_read` tool is registered and callable
 * through the registry.
 * @module vision-plugin/tests/load
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { makeConfig, PNG_DATA_URI, jsonResponse } from './helpers.ts'

/** Plugin object form mirroring the loader's function-plugin namespace. */
const visionPlugin = { name: 'vision', inject: ['tools'], apply }

/** Fibers started per test, disposed in reverse order after each test. */
const fibers: Array<{ dispose: () => Promise<void> }> = []

afterEach(async () => {
  while (fibers.length > 0) {
    await fibers.pop()!.dispose()
  }
  vi.unstubAllGlobals()
})

describe('plugin composition', () => {
  it('registers vision_read through apply', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    fibers.push(await ctx.plugin(visionPlugin, makeConfig()))

    const tool = ctx.tools.get('vision_read')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('vision_read')
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('vision_read')
  })

  it('disposes the registration when the plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(visionPlugin, makeConfig())
    expect(ctx.tools.get('vision_read')).toBeDefined()

    await fiber.dispose()
    expect(ctx.tools.get('vision_read')).toBeUndefined()
  })

  it('executes the registered tool through the registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    fibers.push(await ctx.plugin(visionPlugin, makeConfig()))

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      choices: [{ message: { content: 'A blue sky' } }],
    })))

    const definition = ctx.tools.get('vision_read')!
    const result = await definition.execute(
      { image: PNG_DATA_URI, question: 'What is in the sky?' },
      {
        signal: new AbortController().signal,
        deferContext: () => {},
        concludeTurn: () => {},
      } as unknown as Parameters<typeof definition.execute>[1],
    )
    expect(result).toBe('A blue sky')
  })
})
