/**
 * Provider registry and the single invocation path every provider family
 * shares: build the wire request, POST it, parse the answer text, and wrap
 * parse failures with the provider name. Zhipu / Qwen / Doubao speak the
 * OpenAI-compatible wire format, so they reuse the OpenAI provider
 * implementation under their own identity.
 * @module vision-plugin/providers
 */

import { postJson } from './http.ts'
import { anthropicProvider } from './providers/anthropic.ts'
import { geminiProvider } from './providers/gemini.ts'
import { openaiProvider } from './providers/openai.ts'
import type { ProviderCall, ProviderKey, ProviderSettings, VisionInput, VisionProvider } from './providers/types.ts'

/** Every supported provider key, in configuration order. */
export const PROVIDER_KEYS: readonly ProviderKey[] = [
  'openai',
  'zhipu',
  'qwen',
  'doubao',
  'anthropic',
  'gemini',
] as const

/**
 * The environment variable each provider's API key is read from when the
 * provider block leaves `apiKey` empty. Keys live in the repo-root `.env`.
 */
export const VENDOR_ENV_KEYS: Record<ProviderKey, string> = {
  openai: 'OPENAI_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  qwen: 'QWEN_API_KEY',
  doubao: 'ARK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

/** Re-export one OpenAI-compatible wire implementation under a vendor identity. */
function compatibleVendor(key: ProviderKey, displayName: string): VisionProvider {
  return {
    key,
    displayName,
    buildRequest: openaiProvider.buildRequest,
    parseResponse: openaiProvider.parseResponse,
  }
}

/** Registry keyed by configuration value. */
export const VISION_PROVIDERS: Record<ProviderKey, VisionProvider> = {
  openai: openaiProvider,
  zhipu: compatibleVendor('zhipu', 'Zhipu (OpenAI-compatible)'),
  qwen: compatibleVendor('qwen', 'Qwen (OpenAI-compatible)'),
  doubao: compatibleVendor('doubao', 'Doubao (OpenAI-compatible)'),
  anthropic: anthropicProvider,
  gemini: geminiProvider,
}

/** Options for {@link invokeVision}. */
export interface InvokeOptions {
  /** Wall-clock budget for the whole provider call. */
  timeoutMs: number
  /** Caller cancellation forwarded to the request. */
  signal?: AbortSignal
}

/**
 * Run one vision question against a provider and return the answer text.
 * @param provider - the provider implementation to invoke.
 * @param settings - resolved provider settings (base URL, key, model, tokens).
 * @param input - the question and image payload.
 * @param options - timeout and cancellation.
 * @returns the vision model's answer text.
 */
export async function invokeVision(
  provider: VisionProvider,
  settings: ProviderSettings,
  input: VisionInput,
  options: InvokeOptions,
): Promise<string> {
  const call: ProviderCall = provider.buildRequest(settings, input)
  const data = await postJson({
    url: call.url,
    headers: call.headers,
    body: call.body,
    timeoutMs: options.timeoutMs,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  try {
    return provider.parseResponse(data)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${provider.displayName} response parse failed: ${message}`, { cause: error })
  }
}
