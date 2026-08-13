/**
 * `vision_read` tool definition: resolves the image reference, forwards it
 * with the question to the configured vision sub-model, and returns the
 * answer text. The UI render intent is `generic` — no custom card — because
 * the call is a single question/answer round trip.
 *
 * The name is distinct from the built-in `read_image` tool (tool-fs), which
 * returns the image bytes for image-capable main models; `vision_read`
 * serves text-only main models such as DeepSeek by outsourcing the reading
 * to a vision API and returning text.
 * @module vision-plugin/tool
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { resolveImage } from './image.ts'
import { resolveProviderSettings, type Config } from './index.ts'
import { invokeVision, VISION_PROVIDERS } from './providers.ts'

/**
 * Cap answer text so one long description cannot flood the main-model context.
 * @param text - the vision model's answer.
 * @param maxChars - configured cap.
 * @returns the answer, truncated with a trailing marker when over the cap.
 */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n… (truncated to ${maxChars} characters)`
}

/**
 * Define the `vision_read` tool for one plugin configuration.
 * @param config - validated plugin configuration.
 * @returns the registry-ready tool definition.
 */
export function defineVisionReadTool(config: Config): ToolDefinition {
  return defineTool({
    name: 'vision_read',
    description: 'Read an image with a vision sub-model and answer a question about it, returning the answer as text. Use this when the user asks about the content of an image — a photo, screenshot, diagram, chart, or scan — especially when the current main model cannot accept image input directly. The image can be a local file path, an http(s) URL, or a data: URI.',
    parameters: {
      image: {
        type: 'string',
        required: true,
        description: 'The image to read: a local file path (absolute, or relative to the harness working directory), an http(s) URL, or a data:image/...;base64,... URI.',
      },
      question: {
        type: 'string',
        description: 'The question to answer about the image; omitted uses the configured default (a detailed description).',
      },
      model: {
        type: 'string',
        description: 'Optional vision-model override; omitted uses the configured vision model.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const image = await resolveImage(args.image, {
        maxBytes: config.maxImageBytes,
        timeoutMs: config.timeoutMs,
        signal: exec.signal,
      })
      const base = resolveProviderSettings(config)
      const modelOverride = (args.model ?? '').trim()
      const settings = modelOverride === '' ? base : { ...base, model: modelOverride }
      const question = (args.question ?? '').trim() || config.defaultQuestion
      const answer = await invokeVision(
        VISION_PROVIDERS[config.provider],
        settings,
        { question, mimeType: image.mimeType, base64: image.base64 },
        { timeoutMs: config.timeoutMs, signal: exec.signal },
      )
      return truncateText(answer, config.maxOutputChars)
    },
  })
}
