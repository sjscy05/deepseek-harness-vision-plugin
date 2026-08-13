/**
 * `vision` plugin entry: validates configuration, resolves the selected
 * provider's settings, and registers the `vision_read` tool. Loaded from
 * `cordis.yml` through a patch overlay; see the plugin README.
 * @module vision-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { PROVIDER_KEYS, VENDOR_ENV_KEYS } from './providers.ts'
import type { ProviderKey, ProviderSettings } from './providers/types.ts'
import { defineVisionReadTool } from './tool.ts'

/** Plugin id used in `cordis.yml`. */
export const name = 'vision'
/** The tool registry must be ready before this plugin applies. */
export const inject = ['tools']

/** Per-provider endpoint defaults applied when `baseUrl` is left empty. */
export const DEFAULT_BASE_URLS: Record<ProviderKey, string> = {
  openai: 'https://api.openai.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

/** Configuration for one provider block in `cordis.yml`. */
export interface ProviderBlock {
  /** Endpoint base; empty uses {@link DEFAULT_BASE_URLS}. */
  baseUrl?: string
  /**
   * Secret sent to the provider. Leave empty to read it from the provider's
   * env variable (see {@link VENDOR_ENV_KEYS}), e.g. `ZHIPU_API_KEY` in the
   * repo-root `.env` — the recommended setup.
   */
  apiKey?: string
  /** Vision model id accepted by the provider. */
  model?: string
  /** Provider-side cap on generated tokens. */
  maxTokens?: number
}

/** Plugin configuration: provider selection plus shared budgets. */
export interface Config {
  /** Which vendor family serves `vision_read` calls; switch by changing this one line. */
  provider: ProviderKey
  /** OpenAI settings (OpenAI, or any OpenAI-compatible gateway via `baseUrl`). */
  openai?: ProviderBlock
  /** Zhipu (BigModel) GLM-4V settings. */
  zhipu?: ProviderBlock
  /** Alibaba Qwen-VL settings (DashScope compatible mode). */
  qwen?: ProviderBlock
  /** ByteDance Doubao settings (Volcengine Ark). */
  doubao?: ProviderBlock
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
  zhipu: providerBlock,
  qwen: providerBlock,
  doubao: providerBlock,
  anthropic: providerBlock,
  gemini: providerBlock,
  timeoutMs: Schema.number().min(1000).default(60_000),
  maxImageBytes: Schema.number().min(1024).default(10 * 1024 * 1024),
  defaultQuestion: Schema.string().default('Describe the image in detail, including any visible text.'),
  maxOutputChars: Schema.number().min(1).default(20_000),
})

/**
 * Resolve the settings of the *selected* provider, applying endpoint
 * defaults, reading the API key from the provider's env variable when the
 * block leaves `apiKey` empty, and validating that a key and model exist.
 * Called at load and per tool call so configuration edits reach the next
 * request without re-registration.
 * @param config - validated plugin configuration.
 * @returns resolved settings for the selected provider.
 */
export function resolveProviderSettings(config: Config): ProviderSettings {
  const raw = config.provider === 'openai'
    ? config.openai
    : config.provider === 'zhipu'
      ? config.zhipu
      : config.provider === 'qwen'
        ? config.qwen
        : config.provider === 'doubao'
          ? config.doubao
          : config.provider === 'anthropic'
            ? config.anthropic
            : config.gemini
  if (raw === undefined) {
    throw new Error(
      `vision: provider "${config.provider}" is selected but its settings block (${config.provider}:) is missing from the plugin config`,
    )
  }
  const envKeyName = VENDOR_ENV_KEYS[config.provider]
  const apiKey = (raw.apiKey ?? '').trim() || (process.env[envKeyName] ?? '').trim()
  if (apiKey.length === 0) {
    throw new Error(
      `vision: provider "${config.provider}" has no apiKey; set ${envKeyName} in the repo-root .env (or the ${config.provider}: block's apiKey)`,
    )
  }
  const model = (raw.model ?? '').trim()
  if (model.length === 0) {
    throw new Error(
      `vision: provider "${config.provider}" has an empty model; set model: in its block in cordis.yml`,
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
  // misconfiguration the operator must fix in cordis.yml / .env.
  resolveProviderSettings(config)
  ctx.tools.register(defineVisionReadTool(config))
}
