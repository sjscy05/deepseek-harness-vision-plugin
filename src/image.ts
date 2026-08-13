/**
 * Resolve a tool-supplied image reference — local file path, http(s) URL, or
 * data URI — into the base64 payload and media type a vision provider
 * accepts. Every path enforces the configured byte budget on the decoded
 * image before any provider request is built.
 * @module vision-plugin/image
 */

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

/** A resolved image payload ready for a vision provider request. */
export interface ResolvedImage {
  /** IANA media type of the image, e.g. `image/png`. */
  mimeType: string
  /** Base64-encoded image bytes without the `data:` URI prefix. */
  base64: string
  /** Decoded byte length of the image. */
  byteLength: number
  /** How the source reference was interpreted. */
  sourceKind: 'path' | 'url' | 'data-uri'
}

/**
 * Extension → media type map restricted to the formats the mainstream vision
 * APIs (OpenAI, Anthropic, Gemini) all accept.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const SUPPORTED_EXTENSIONS = Object.keys(MIME_BY_EXTENSION).join(', ')

const DATA_URI_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i

/** Options for {@link resolveImage}. */
export interface ResolveImageOptions {
  /** Upper bound on decoded image bytes; larger images fail with an error. */
  maxBytes: number
  /** Wall-clock budget for URL downloads. */
  timeoutMs: number
  /** Caller cancellation forwarded to the download fetch. */
  signal?: AbortSignal
}

/**
 * Map a file extension to a media type, or `undefined` for unsupported ones.
 * @param filePath - path or URL whose extension is inspected.
 * @returns the media type, or `undefined` when the extension is unsupported.
 */
export function mimeTypeForExtension(filePath: string): string | undefined {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()]
}

/**
 * Resolve `source` into a provider-ready image payload. `data:` URIs are
 * parsed in place, http(s) URLs are downloaded with a timeout, and anything
 * else is treated as a local file path resolved against the harness working
 * directory.
 * @param source - image reference: data URI, http(s) URL, or file path.
 * @param options - byte budget, download timeout, and cancellation signal.
 * @returns the resolved payload; throws on unsupported or oversized input.
 */
export async function resolveImage(source: string, options: ResolveImageOptions): Promise<ResolvedImage> {
  const trimmed = source.trim()
  if (trimmed.startsWith('data:')) return resolveDataUri(trimmed, options.maxBytes)
  if (/^https?:\/\//i.test(trimmed)) return resolveUrl(trimmed, options)
  return resolveFilePath(trimmed, options.maxBytes)
}

function resolveDataUri(uri: string, maxBytes: number): ResolvedImage {
  const match = DATA_URI_RE.exec(uri)
  if (match === null) {
    throw new Error('invalid data URI: expected data:<media-type>;base64,<payload>')
  }
  const mimeType = match[1]!.toLowerCase()
  if (!mimeType.startsWith('image/')) {
    throw new Error(`unsupported data-URI media type "${mimeType}"; expected an image/* type`)
  }
  const base64 = match[2]!.replace(/\s+/g, '')
  const byteLength = Buffer.from(base64, 'base64').byteLength
  assertWithinBudget(byteLength, maxBytes, 'data URI image')
  return { mimeType, base64, byteLength, sourceKind: 'data-uri' }
}

async function resolveFilePath(filePath: string, maxBytes: number): Promise<ResolvedImage> {
  const absolute = path.resolve(filePath)
  let info
  try {
    info = await stat(absolute)
  } catch {
    throw new Error(`image file not found: ${absolute}`)
  }
  if (!info.isFile()) throw new Error(`image path is not a file: ${absolute}`)
  const mimeType = mimeTypeForExtension(absolute)
  if (mimeType === undefined) {
    throw new Error(`unsupported image extension in "${absolute}"; supported: ${SUPPORTED_EXTENSIONS}`)
  }
  assertWithinBudget(info.size, maxBytes, `image file "${absolute}"`)
  const bytes = await readFile(absolute)
  return {
    mimeType,
    base64: bytes.toString('base64'),
    byteLength: bytes.byteLength,
    sourceKind: 'path',
  }
}

async function resolveUrl(url: string, options: ResolveImageOptions): Promise<ResolvedImage> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal === undefined
    ? timeoutSignal
    : AbortSignal.any([timeoutSignal, options.signal])
  let response: Response
  try {
    response = await fetch(url, { redirect: 'follow', signal })
  } catch (error: unknown) {
    if (options.signal?.aborted) throw error
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`image download timed out after ${options.timeoutMs} ms: ${url}`)
    }
    throw new Error(`failed to download image URL: ${url}`, { cause: error })
  }
  if (!response.ok) {
    throw new Error(`failed to download image URL (HTTP ${response.status}): ${url}`)
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (Number.isFinite(length)) assertWithinBudget(length, options.maxBytes, `image URL "${url}"`)
  }
  const mimeType = pickMime(response.headers.get('content-type'), url)
  const bytes = new Uint8Array(await response.arrayBuffer())
  assertWithinBudget(bytes.byteLength, options.maxBytes, `image URL "${url}"`)
  return {
    mimeType,
    base64: Buffer.from(bytes).toString('base64'),
    byteLength: bytes.byteLength,
    sourceKind: 'url',
  }
}

function pickMime(contentType: string | null, url: string): string {
  if (contentType !== null) {
    const first = contentType.split(';')[0]
    if (first !== undefined) {
      const mime = first.trim().toLowerCase()
      if (mime.startsWith('image/')) return mime
    }
  }
  const byExtension = mimeTypeForExtension(url)
  if (byExtension !== undefined) return byExtension
  throw new Error(
    `could not determine the image type of "${url}": non-image content-type and unsupported extension; supported: ${SUPPORTED_EXTENSIONS}`,
  )
}

function assertWithinBudget(byteLength: number, maxBytes: number, subject: string): void {
  if (byteLength > maxBytes) {
    throw new Error(`${subject} is ${byteLength} bytes, exceeding the ${maxBytes}-byte limit`)
  }
}
