/**
 * Minimal JSON POST helper for vision provider calls: wall-clock timeout,
 * caller-abort forwarding, and provider error-body mapping. Every provider
 * request goes through here so failure modes stay uniform.
 * @module vision-plugin/http
 */

/** Options for {@link postJson}. */
export interface JsonPostOptions {
  /** Full request URL. */
  url: string
  /** Extra headers; `content-type: application/json` is always sent. */
  headers: Record<string, string>
  /** JSON-serializable request body. */
  body: unknown
  /** Wall-clock budget; expiry surfaces as a `vision request timed out` error. */
  timeoutMs: number
  /** Caller cancellation; an aborted signal wins over the timeout. */
  signal?: AbortSignal
}

/** A failed provider HTTP response with the status and parsed message preserved. */
export interface ProviderHttpError extends Error {
  /** HTTP status of the failed response. */
  readonly status: number
  /** Provider-supplied error message, truncated to 500 characters. */
  readonly providerMessage: string
}

/**
 * POST a JSON body and return the parsed JSON response. Non-2xx responses
 * throw a {@link ProviderHttpError} carrying the provider message; timeouts
 * throw a plain error naming the budget; caller aborts rethrow the original
 * abort reason.
 * @param options - request construction described on {@link JsonPostOptions}.
 * @returns the parsed JSON response body.
 */
export async function postJson(options: JsonPostOptions): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal === undefined
    ? timeoutSignal
    : AbortSignal.any([timeoutSignal, options.signal])
  let response: Response
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(options.body),
      signal,
    })
  } catch (error: unknown) {
    if (options.signal?.aborted) throw error
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`vision request timed out after ${options.timeoutMs} ms`)
    }
    throw error
  }
  if (!response.ok) {
    const providerMessage = await readErrorMessage(response)
    const error = new Error(
      `vision provider error (HTTP ${response.status}): ${providerMessage}`,
    ) as Error & { status: number; providerMessage: string }
    error.status = response.status
    error.providerMessage = providerMessage
    throw error
  }
  try {
    return await response.json()
  } catch {
    throw new Error('vision provider returned a non-JSON response')
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  // Read the body exactly once: a failed json() attempt consumes it, so the
  // raw-text fallback parses the same text instead of re-reading.
  const text = await response.text()
  try {
    const data = JSON.parse(text) as unknown
    const message = extractMessage(data)
    if (message.length > 0) return message
  } catch {
    // Non-JSON error body; fall through to the raw text.
  }
  return text.length > 0 ? truncate(text) : `no error detail (HTTP ${response.status})`
}

function extractMessage(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const record = data as Record<string, unknown>
  const candidate = record.error ?? record.message
  if (typeof candidate === 'string') return truncate(candidate)
  if (typeof candidate === 'object' && candidate !== null) {
    const nested = candidate as Record<string, unknown>
    if (typeof nested.message === 'string') return truncate(nested.message)
    if (typeof nested.code === 'string') return truncate(nested.code)
  }
  return ''
}

function truncate(text: string): string {
  return text.length <= 500 ? text : `${text.slice(0, 500)}…`
}
