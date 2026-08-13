# vision-plugin

A scratch plugin for [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) that lets the text-only DeepSeek main model read images through a **vision sub-model**: the agent calls the `vision_read` tool, the plugin forwards the image plus a question to a configured vision API, and returns the vision model's answer as text.

Follows the [Your first plugin](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) guide: a Cordis function plugin registering one tool through `ctx.tools.register`.

This repository is the plugin source; it resolves the `@deepseek-ai/*` dependencies through the deepseek-harness checkout's tsconfig paths, so use it by keeping the folder inside a deepseek-harness checkout (the default location is `vision-plugin/` at the repo root).

## How it works

```
user: "这张图里有什么？"  →  DeepSeek (text-only main model)
        └─ calls vision_read(image=..., question=...)
             └─ vision-plugin resolves the image (path / URL / data URI)
                  └─ POSTs it to the configured vision provider (OpenAI-compatible / Anthropic / Gemini)
                       └─ returns the vision model's answer as tool-result text
```

The harness already ships a `read_image` tool (tool-fs) that returns the image bytes for image-capable main models; `vision_read` deliberately uses a different name and complements it — it serves text-only main models such as DeepSeek by outsourcing the reading to a vision API and returning text.

## Provider compatibility

The vision sub-model is selected by `config.provider` and speaks mainstream API formats:

| `provider` | API | Example models | Config |
| --- | --- | --- | --- |
| `openai` | OpenAI-compatible `chat/completions` (`image_url` parts) | OpenAI `gpt-4o` / `gpt-4o-mini` / `gpt-4.1`; Qwen-VL (DashScope compatible mode); Zhipu GLM-4V; Moonshot; Mistral; xAI; local vLLM/Ollama gateways | `openai: { baseUrl, apiKey, model }` |
| `anthropic` | Anthropic Messages API (`image` base64 blocks) | Claude vision models, e.g. `claude-sonnet-4-5` | `anthropic: { baseUrl, apiKey, model }` |
| `gemini` | Google Gemini `generateContent` (`inline_data` parts) | `gemini-2.0-flash`, `gemini-2.5-flash` | `gemini: { baseUrl, apiKey, model }` |

An empty `baseUrl` uses the provider default (`https://api.openai.com/v1`, `https://api.anthropic.com`, `https://generativelanguage.googleapis.com/v1beta`). Any OpenAI-compatible endpoint works by pointing `openai.baseUrl` at it — this is how the plugin stays compatible with the mainstream model ecosystem without per-vendor SDKs.

## Load the plugin

From the repository root:

```sh
pnpm dsh --profile web --patch ./vision-plugin/cordis.yml
```

The patch overlay inserts the plugin with the `openai` provider preconfigured. The `apiKey` rows read environment variables via the cordis `!!js` tag:

```yaml
- insert:
    - id: vision
      # Must be absolute; on Windows use the file:/// URL form (the ESM
      # loader rejects bare drive-letter paths).
      name: 'file:///D:/deepseek-harness/vision-plugin/src/index.ts'
      config:
        provider: openai
        openai:
          baseUrl: 'https://api.openai.com/v1'
          apiKey: !!js process.env.OPENAI_API_KEY
          model: 'gpt-4o-mini'
```

The selected provider's block must carry a non-empty `apiKey` and `model`; missing configuration fails the plugin load with an actionable error (never a silent fallback). Set e.g. `OPENAI_API_KEY=sk-...` before starting.

## Configuration reference

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `provider` | `openai` \| `anthropic` \| `gemini` | `openai` | Vision API family serving `vision_read` calls |
| `<provider>.baseUrl` | string | per-provider default | API endpoint base |
| `<provider>.apiKey` | string | required | Secret; supply via `!!js process.env.X` |
| `<provider>.model` | string | required | Vision model id |
| `<provider>.maxTokens` | number | `1024` | Provider-side cap on generated tokens |
| `timeoutMs` | number | `60000` | Wall-clock budget for image download and the provider call |
| `maxImageBytes` | number | `10485760` | Upper bound on decoded image bytes (10 MiB) |
| `defaultQuestion` | string | detailed-description prompt | Question used when a call omits `question` |
| `maxOutputChars` | number | `20000` | Cap on answer text returned to the main model |

## Tool contract

`vision_read(image, question?, model?)` — the UI render intent is `generic` (single question/answer round trip, no custom card).

- `image` (required): a local file path (absolute, or relative to the harness working directory), an http(s) URL (downloaded with the same timeout budget), or a `data:image/...;base64,...` URI. Supported formats: PNG, JPEG, WebP, GIF.
- `question`: what to ask about the image; defaults to the configured `defaultQuestion`.
- `model`: per-call vision-model override.
- Returns: the vision model's answer as text.

## Development

```sh
pnpm -C vision-plugin typecheck   # tsc over src + tests
pnpm -C vision-plugin test        # vitest, keyless (fetch is mocked)
```

Tests cover image resolution (data URI / path / URL, byte budgets), the three providers' wire requests and response parsing, HTTP error and timeout mapping, end-to-end tool execution, and an in-process Cordis composition check that `apply` registers and unregisters the tool.

## Known Limitations

- One image per call; the main model can call the tool repeatedly for several images.
- Non-streaming responses only — fine for a tool result.
- Image bytes are inlined as base64 into every provider request; no caching is attempted.
- Tests are keyless and mock `fetch`; a live call needs a real API key for the selected provider.
