/**
 * Provider-neutral vision types: the settings block each provider reads, the
 * per-call image input, and the provider interface implemented by all API
 * families. Types only — no runtime code.
 * @module vision-plugin/providers/types
 */

/** The supported vision API families. Zhipu / Qwen / Doubao are OpenAI-compatible. */
export type ProviderKey =
  | 'openai'
  | 'zhipu'
  | 'qwen'
  | 'doubao'
  | 'anthropic'
  | 'gemini'

/** Configuration for one vision provider, resolved and validated at load. */
export interface ProviderSettings {
  /** API endpoint base; each provider appends its own route. */
  baseUrl: string
  /** Secret sent to the provider (Bearer token or API key). */
  apiKey: string
  /** Vision model id accepted by the provider, e.g. `gpt-4o-mini`. */
  model: string
  /** Provider-side cap on generated tokens. */
  maxTokens: number
}

/** Per-call image input shared by every provider. */
export interface VisionInput {
  /** The question the vision model must answer about the image. */
  question: string
  /** IANA media type of the image, e.g. `image/png`. */
  mimeType: string
  /** Base64-encoded image bytes. */
  base64: string
}

/** A fully constructed provider request, ready for {@link postJson}. */
export interface ProviderCall {
  url: string
  headers: Record<string, string>
  body: unknown
}

/** One vision API family: builds its wire request and parses its response. */
export interface VisionProvider {
  /** Stable key used in plugin configuration. */
  readonly key: ProviderKey
  /** Human-readable name used in error messages. */
  readonly displayName: string
  /** Build the wire request for one image question. */
  buildRequest(settings: ProviderSettings, input: VisionInput): ProviderCall
  /** Extract the answer text from a parsed JSON response; throws on empty or malformed content. */
  parseResponse(data: unknown): string
}
