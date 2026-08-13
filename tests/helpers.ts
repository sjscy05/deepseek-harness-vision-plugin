/**
 * Shared test fixtures: a tiny PNG-signature byte array, its base64 form,
 * and a default plugin Config.
 * @module vision-plugin/tests/helpers
 */

import type { Config } from '../src/index.ts'

/** Minimal PNG file signature (the plugin never decodes image bytes). */
export const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])

/** Base64 of {@link PNG_SIG}. */
export const PNG_SIG_B64 = Buffer.from(PNG_SIG).toString('base64')

/** A data URI carrying {@link PNG_SIG}. */
export const PNG_DATA_URI = `data:image/png;base64,${PNG_SIG_B64}`

/** Build a plugin Config with schema-consistent defaults for tests. */
export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: 'openai',
    openai: {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    },
    timeoutMs: 30_000,
    maxImageBytes: 1024 * 1024,
    defaultQuestion: 'Describe the image in detail, including any visible text.',
    maxOutputChars: 20_000,
    ...overrides,
  }
}

/** A JSON 200 response body helper for fetch mocks. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
