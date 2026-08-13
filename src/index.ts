/**
 * `vision` plugin entry: validates configuration, resolves the selected
 * provider's settings, and registers the `vision_read` tool. Loaded from
 * `cordis.yml` through a patch overlay; see the plugin README.
 * @module vision-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { PROVIDER_KEYS } from './providers.ts'
import type { ProviderKey, ProviderSettings } from './providers/types.ts'
import { defineVisionReadTool } from './tool.ts'

/** Plugin id used in `cordis.yml`. */
export const name = 'vision'
/** The tool registry must be ready before this plugin applies. */
export const inject = ['tools']

/** Per-provider endpoint defaults applied when `baseUrl` is left empty. */
export const DEFAULT_BASE_URLS: Record<ProviderKey, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

/** Configuration for one provider block in `cordis.yml`. */
export interface ProviderBlock {
  /** Endpoint base; empty uses {@link DEFAULT_BASE_URLS}. */
  baseUrl?: string
  /** Secret sent to the provider; supply via `!!js process.env.X` in cordis.yml. */
  apiKey?: string
  /** Vision model id accepted by the provider. */
  model?: string
  /** Provider-side cap on generated tokens. */
  maxTokens?: number
}

/** Plugin configuration: provider selection plus shared budgets. */
export interface Config {
  /** Which provider family serves `vision_read` calls. */
  provider: ProviderKey
  /** OpenAI-compatible chat-completions settings. */
  openai?: ProviderBlock
  /** Anthropic Messages API settings. */
  anthropic?: ProviderBlock
  /** Google Gemini generateContent settings. */
  gemini?: ProviderBlock
  /** Wall-clock budget for image download and the provider call. */
  timeoutMs: number
  /** Upper bound on decoded image bytes. */
  maxImageBytes: number
  /** Question used when a tool call omits `question`. */
  defaultQuestion: string
  /** Cap on the answer text returned to the main model. */
  maxOutputChars: number
}

const providerBlock = Schema.object({
  baseUrl: Schema.string().default(''),
  apiKey: Schema.string().default(''),
  model: Schema.string().default(''),
  maxTokens: Schema.number().min(1).default(1024),
})

/** Cordis validation schema; defaults live on the fields. */
export const Config: Schema<Config> = Schema.object({
  provider: Schema.union([...PROVIDER_KEYS]).default('openai'),
  openai: providerBlock,
  anthropic: providerBlock,
  gemini: providerBlock,
  timeoutMs: Schema.number().min(1000).default(60_000),
  maxImageBytes: Schema.number().min(1024).default(10 * 1024 * 1024),
  defaultQuestion: Schema.string().default('Describe the image in detail, including any visible text.'),
  maxOutputChars: Schema.number().min(1).default(20_000),
})

/**
 * Resolve the settings of the *selected* provider, applying endpoint
 * defaults and validating that the block exists and carries a key and model.
 * Called at load and per tool call so configuration edits reach the next
 * request without re-registration.
 * @param config - validated plugin configuration.
 * @returns resolved settings for the selected provider.
 */
export function resolveProviderSettings(config: Config): ProviderSettings {
  const raw = config.provider === 'openai'
    ? config.openai
    : config.provider === 'anthropic'
      ? config.anthropic
      : config.gemini
  if (raw === undefined) {
    throw new Error(
      `vision: provider "${config.provider}" is selected but its settings block (${config.provider}:) is missing from the plugin config`,
    )
  }
  const apiKey = (raw.apiKey ?? '').trim()
  if (apiKey.length === 0) {
    throw new Error(
      `vision: provider "${config.provider}" has an empty apiKey; set it in cordis.yml, e.g. apiKey: !!js process.env.OPENAI_API_KEY`,
    )
  }
  const model = (raw.model ?? '').trim()
  if (model.length === 0) {
    throw new Error(
      `vision: provider "${config.provider}" has an empty model; set model: in cordis.yml, e.g. model: 'gpt-4o-mini'`,
    )
  }
  return {
    baseUrl: (raw.baseUrl ?? '').trim() || DEFAULT_BASE_URLS[config.provider],
    apiKey,
    model,
    maxTokens: raw.maxTokens ?? 1024,
  }
}

/**
 * Apply the plugin: fail loudly on misconfiguration, then register the
 * `vision_read` tool. Registrations are effects and clean up on unload.
 * @param ctx - Cordis context; `ctx.tools` is ready (declared in `inject`).
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config) {
  // Fail at load, not on the first call: a missing block or key is a static
  // misconfiguration the operator must fix in cordis.yml.
  resolveProviderSettings(config)
  ctx.tools.register(defineVisionReadTool(config))
}
