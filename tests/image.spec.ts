/**
 * Unit tests for image reference resolution: data URIs, local paths, and
 * URL downloads, including byte-budget enforcement.
 * @module vision-plugin/tests/image
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveImage } from '../src/image.ts'
import { PNG_DATA_URI, PNG_SIG, PNG_SIG_B64 } from './helpers.ts'

const DEFAULT_OPTS = { maxBytes: 1024, timeoutMs: 5000 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveImage data URIs', () => {
  it('parses a valid image data URI', async () => {
    const image = await resolveImage(PNG_DATA_URI, DEFAULT_OPTS)
    expect(image).toEqual({
      mimeType: 'image/png',
      base64: PNG_SIG_B64,
      byteLength: PNG_SIG.byteLength,
      sourceKind: 'data-uri',
    })
  })

  it('normalizes whitespace inside the base64 payload', async () => {
    const spaced = `data:image/png;base64,${PNG_SIG_B64.slice(0, 4)} ${PNG_SIG_B64.slice(4)}`
    const image = await resolveImage(spaced, DEFAULT_OPTS)
    expect(image.base64).toBe(PNG_SIG_B64)
  })

  it('accepts any image/* media type', async () => {
    const image = await resolveImage(`data:image/webp;base64,${PNG_SIG_B64}`, DEFAULT_OPTS)
    expect(image.mimeType).toBe('image/webp')
  })

  it('rejects non-image media types', async () => {
    await expect(
      resolveImage(`data:text/plain;base64,${PNG_SIG_B64}`, DEFAULT_OPTS),
    ).rejects.toThrow('unsupported data-URI media type "text/plain"')
  })

  it('rejects malformed data URIs', async () => {
    await expect(resolveImage('data:image/png;base64,!!!not-base64!!!', DEFAULT_OPTS))
      .rejects.toThrow('invalid data URI')
    await expect(resolveImage('data:image/png,raw', DEFAULT_OPTS)).rejects.toThrow('invalid data URI')
  })

  it('rejects data URIs over the byte budget', async () => {
    await expect(resolveImage(PNG_DATA_URI, { ...DEFAULT_OPTS, maxBytes: 4 }))
      .rejects.toThrow('exceeding the 4-byte limit')
  })
})

describe('resolveImage local paths', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'vision-plugin-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads a local PNG file with its extension-derived media type', async () => {
    const file = path.join(dir, 'pic.png')
    await writeFile(file, PNG_SIG)
    const image = await resolveImage(file, DEFAULT_OPTS)
    expect(image.mimeType).toBe('image/png')
    expect(image.base64).toBe(PNG_SIG_B64)
    expect(image.sourceKind).toBe('path')
  })

  it('resolves relative paths against the working directory', async () => {
    const file = path.join(dir, 'pic.jpeg')
    await writeFile(file, PNG_SIG)
    const image = await resolveImage(file, DEFAULT_OPTS)
    expect(image.mimeType).toBe('image/jpeg')
  })

  it('rejects unsupported extensions', async () => {
    const file = path.join(dir, 'pic.bin')
    await writeFile(file, PNG_SIG)
    await expect(resolveImage(file, DEFAULT_OPTS)).rejects.toThrow('unsupported image extension')
  })

  it('rejects missing files', async () => {
    await expect(resolveImage(path.join(dir, 'nope.png'), DEFAULT_OPTS))
      .rejects.toThrow('image file not found')
  })

  it('rejects directories', async () => {
    await expect(resolveImage(dir, DEFAULT_OPTS)).rejects.toThrow('is not a file')
  })

  it('rejects files over the byte budget', async () => {
    const file = path.join(dir, 'big.png')
    await writeFile(file, PNG_SIG)
    await expect(resolveImage(file, { ...DEFAULT_OPTS, maxBytes: 4 }))
      .rejects.toThrow('exceeding the 4-byte limit')
  })
})

describe('resolveImage URLs', () => {
  const url = 'https://example.com/pic.png'

  it('downloads and derives the media type from content-type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG_SIG, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })))
    const image = await resolveImage(url, DEFAULT_OPTS)
    expect(image.mimeType).toBe('image/png')
    expect(image.base64).toBe(PNG_SIG_B64)
    expect(image.sourceKind).toBe('url')
  })

  it('falls back to the URL extension for a non-image content-type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG_SIG, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    })))
    const image = await resolveImage(url, DEFAULT_OPTS)
    expect(image.mimeType).toBe('image/png')
  })

  it('strips parameters from the content-type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG_SIG, {
      status: 200,
      headers: { 'content-type': 'image/jpeg; charset=binary' },
    })))
    const image = await resolveImage(url, DEFAULT_OPTS)
    expect(image.mimeType).toBe('image/jpeg')
  })

  it('rejects non-2xx downloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    await expect(resolveImage(url, DEFAULT_OPTS)).rejects.toThrow('HTTP 404')
  })

  it('rejects downloads whose content-length exceeds the budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG_SIG, {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '4096' },
    })))
    await expect(resolveImage(url, { ...DEFAULT_OPTS, maxBytes: 100 }))
      .rejects.toThrow('exceeding the 100-byte limit')
  })

  it('rejects downloads whose body exceeds the budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG_SIG, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })))
    await expect(resolveImage(url, { ...DEFAULT_OPTS, maxBytes: 4 }))
      .rejects.toThrow('exceeding the 4-byte limit')
  })
})
