/**
 * Direct vision-API smoke test: exercises the plugin's own image resolution
 * and provider layers against a REAL provider API, without booting the
 * harness. Needs one vision API key.
 *
 * Run from the deepseek-harness checkout (the plugin resolves its
 * @deepseek-ai/* dependencies through the harness dependency tree). Keys are
 * read from the environment — the repo-root .env is loaded by the harness,
 * so `pnpm -C vision-plugin test:direct` picks up .env too:
 *   pnpm -C vision-plugin test:direct
 *
 * Environment:
 *   PROVIDER   openai | zhipu | qwen | doubao | anthropic | gemini (default: zhipu)
 *   *_API_KEY  read per vendor from .env / env (ZHIPU_API_KEY, QWEN_API_KEY,
 *              ARK_API_KEY, OPENAI_API_KEY, ...); API_KEY overrides all
 *   MODEL      vision model id (per-vendor default when omitted)
 *   BASE_URL   optional endpoint override
 *   IMAGE      path, http(s) URL, or data URI (default: repo-root deepseekharness-doubao.png)
 *   QUESTION   the question to ask (default: detailed Chinese description)
 * @module vision-plugin/scripts/direct-test
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveImage } from '../src/image.ts'
import { invokeVision, PROVIDER_KEYS, VENDOR_ENV_KEYS, VISION_PROVIDERS } from '../src/providers.ts'
import type { ProviderKey } from '../src/providers/types.ts'

/**
 * The repo-root .env is normally loaded by the harness boot; this script
 * loads it too so `pnpm -C vision-plugin test:direct` sees the keys.
 */
const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE)
  } catch (error: unknown) {
    console.warn(`[direct-test] failed to load ${ENV_FILE}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Default endpoints, mirroring the plugin Config (kept local so this script stays light). */
const DEFAULT_BASE_URLS: Record<ProviderKey, string> = {
  openai: 'https://api.openai.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

/** Default vision models per vendor; override with MODEL. */
const DEFAULT_MODELS: Record<ProviderKey, string> = {
  openai: 'gpt-4o-mini',
  zhipu: 'glm-4v-flash',
  qwen: 'qwen-vl-plus',
  doubao: 'doubao-1.5-vision-pro-32k-250115',
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.0-flash',
}

/** The test image shipped at the deepseek-harness repo root. */
const DEFAULT_IMAGE = fileURLToPath(new URL('../../deepseekharness-doubao.png', import.meta.url))

function fail(message: string): never {
  console.error(`[direct-test] ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const providerName = (process.env.PROVIDER ?? 'zhipu').trim() as ProviderKey
  if (!PROVIDER_KEYS.includes(providerName)) {
    fail(`PROVIDER must be one of: ${PROVIDER_KEYS.join(' | ')}`)
  }
  const provider = VISION_PROVIDERS[providerName]

  const envKey = process.env.API_KEY ?? process.env[VENDOR_ENV_KEYS[providerName]]
  if (envKey === undefined || envKey.trim().length === 0) {
    fail(`no API key: set ${VENDOR_ENV_KEYS[providerName]} in the repo-root .env (or API_KEY)`)
  }
  const model = process.env.MODEL?.trim() || DEFAULT_MODELS[providerName]
  const baseUrl = process.env.BASE_URL?.trim() || DEFAULT_BASE_URLS[providerName]
  const image = process.env.IMAGE?.trim() || DEFAULT_IMAGE
  const question = process.env.QUESTION?.trim() || '用中文详细描述这张图片，包括所有可见文字。'

  console.log(`[direct-test] provider=${providerName} model=${model} baseUrl=${baseUrl}`)
  console.log(`[direct-test] image=${image}`)

  const resolved = await resolveImage(image, { maxBytes: 20 * 1024 * 1024, timeoutMs: 60_000 })
  console.log(`[direct-test] image resolved: ${resolved.mimeType}, ${resolved.byteLength} bytes (${resolved.sourceKind})`)

  const answer = await invokeVision(
    provider,
    { baseUrl, apiKey: envKey.trim(), model, maxTokens: 1024 },
    { question, mimeType: resolved.mimeType, base64: resolved.base64 },
    { timeoutMs: 120_000 },
  )
  console.log(`\n=== ${provider.displayName} answer ===\n\n${answer}\n`)
}

main().catch(error => {
  fail(error instanceof Error ? error.message : String(error))
})
