# vision-plugin

[中文](#中文) | [English](#english)

## 中文

一个用于 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 的 scratch 插件：让纯文本的 DeepSeek 主模型通过**视觉子模型**阅读图片。代理调用 `vision_read` 工具，插件把图片和问题转发给配置好的视觉 API，再把视觉模型的回答以文本形式返回。

实现遵循 [你的第一个插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) 指南：一个 Cordis 函数插件，通过 `ctx.tools.register` 注册一个工具。

本仓库是插件源码：`@deepseek-ai/*` 依赖通过 deepseek-harness 仓库的 tsconfig paths 解析，因此使用时需要把本目录放进 deepseek-harness 检出目录中（默认位置是仓库根目录下的 `vision-plugin/`）。

### 工作原理

```
用户: "这张图里有什么？"  →  DeepSeek（纯文本主模型）
        └─ 调用 vision_read(image=..., question=...)
             └─ vision-plugin 解析图片（本地路径 / URL / data URI）
                  └─ POST 到配置好的视觉 provider（OpenAI 兼容 / Anthropic / Gemini）
                       └─ 以工具结果文本返回视觉模型的回答
```

Harness 内置的 `read_image` 工具（tool-fs）会把图片字节返回给支持图片输入的主模型；`vision_read` 刻意使用不同的名字，与它互补——它服务于 DeepSeek 这类纯文本主模型，把"看图"外包给视觉 API 并返回文本。

### 视觉子模型兼容性

视觉子模型由 `config.provider` 选择，兼容主流 API 格式：

| `provider` | API | 示例模型 | 配置 |
| --- | --- | --- | --- |
| `openai` | OpenAI 兼容 `chat/completions`（`image_url` 部分） | OpenAI `gpt-4o` / `gpt-4o-mini` / `gpt-4.1`；Qwen-VL（DashScope 兼容模式）；智谱 GLM-4V；Moonshot；Mistral；xAI；本地 vLLM/Ollama 网关 | `openai: { baseUrl, apiKey, model }` |
| `anthropic` | Anthropic Messages API（base64 `image` 块） | Claude 视觉模型，如 `claude-sonnet-4-5` | `anthropic: { baseUrl, apiKey, model }` |
| `gemini` | Google Gemini `generateContent`（`inline_data` 部分） | `gemini-2.0-flash`、`gemini-2.5-flash` | `gemini: { baseUrl, apiKey, model }` |

`baseUrl` 留空时使用各 provider 的默认端点（`https://api.openai.com/v1`、`https://api.anthropic.com`、`https://generativelanguage.googleapis.com/v1beta`）。把 `openai.baseUrl` 指向任意 OpenAI 兼容端点即可接入对应网关——这也是插件无需任何厂商 SDK 就能兼容主流模型生态的原因。

### 加载插件

在 deepseek-harness 仓库根目录执行：

```sh
pnpm dsh --profile web --patch ./vision-plugin/cordis.yml
```

patch overlay 会插入插件并预置 `openai` provider。`apiKey` 通过 cordis 的 `!!js` 标签读取环境变量：

```yaml
- insert:
    - id: vision
      # 路径必须为绝对路径；Windows 下必须使用 file:/// URL 形式
      # （ESM loader 拒绝裸盘符路径）。
      name: 'file:///D:/deepseek-harness/vision-plugin/src/index.ts'
      config:
        provider: openai
        openai:
          baseUrl: 'https://api.openai.com/v1'
          apiKey: !!js process.env.OPENAI_API_KEY
          model: 'gpt-4o-mini'
```

所选 provider 的配置块必须带有非空的 `apiKey` 和 `model`；配置缺失会在插件加载时直接报出可操作的错误（绝不会静默回退）。启动前先设置环境变量，如 `OPENAI_API_KEY=sk-...`。

### 配置参考

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `provider` | `openai` \| `anthropic` \| `gemini` | `openai` | 服务 `vision_read` 调用的视觉 API 家族 |
| `<provider>.baseUrl` | string | 各 provider 默认端点 | API 端点基地址 |
| `<provider>.apiKey` | string | 必填 | 密钥；通过 `!!js process.env.X` 提供 |
| `<provider>.model` | string | 必填 | 视觉模型 id |
| `<provider>.maxTokens` | number | `1024` | 生成 token 的上限 |
| `timeoutMs` | number | `60000` | 图片下载与 provider 调用的总超时（毫秒） |
| `maxImageBytes` | number | `10485760` | 解码后图片字节上限（10 MiB） |
| `defaultQuestion` | string | 详细描述提示词 | 调用未传 `question` 时使用的默认问题 |
| `maxOutputChars` | number | `20000` | 返回给主模型的回答文本上限 |

### 工具契约

`vision_read(image, question?, model?)` — UI 呈现意图为 `generic`（单次问答往返，无自定义卡片）。

- `image`（必填）：本地文件路径（绝对路径，或相对 harness 工作目录的路径）、http(s) URL（按同一超时预算下载）、或 `data:image/...;base64,...` URI。支持格式：PNG、JPEG、WebP、GIF。
- `question`：针对图片提出的问题；缺省使用配置的 `defaultQuestion`。
- `model`：单次调用的视觉模型覆盖。
- 返回：视觉模型的回答文本。

### 开发

```sh
pnpm -C vision-plugin typecheck   # tsc 检查 src + tests
pnpm -C vision-plugin test        # vitest，无需密钥（fetch 为 mock）
```

测试覆盖图片解析（data URI / 路径 / URL，字节上限）、三家 provider 的请求构建与响应解析、HTTP 错误与超时映射、工具端到端执行，以及进程内 Cordis 组合检查（`apply` 注册与注销工具）。

### 已知限制

- 单次调用一张图片；主模型可多次调用该工具处理多张图片。
- 仅支持非流式响应——作为工具结果足够。
- 图片字节以 base64 内联进每次 provider 请求；不做缓存。
- 测试无需密钥且 mock 了 `fetch`；真实调用需要所选 provider 的有效 API key。

---

## English

A scratch plugin for [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) that lets the text-only DeepSeek main model read images through a **vision sub-model**: the agent calls the `vision_read` tool, the plugin forwards the image plus a question to a configured vision API, and returns the vision model's answer as text.

Follows the [Your first plugin](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) guide: a Cordis function plugin registering one tool through `ctx.tools.register`.

This repository is the plugin source; it resolves the `@deepseek-ai/*` dependencies through the deepseek-harness checkout's tsconfig paths, so use it by keeping the folder inside a deepseek-harness checkout (the default location is `vision-plugin/` at the repo root).

### How it works

```
user: "这张图里有什么？"  →  DeepSeek (text-only main model)
        └─ calls vision_read(image=..., question=...)
             └─ vision-plugin resolves the image (path / URL / data URI)
                  └─ POSTs it to the configured vision provider (OpenAI-compatible / Anthropic / Gemini)
                       └─ returns the vision model's answer as tool-result text
```

The harness already ships a `read_image` tool (tool-fs) that returns the image bytes for image-capable main models; `vision_read` deliberately uses a different name and complements it — it serves text-only main models such as DeepSeek by outsourcing the reading to a vision API and returning text.

### Provider compatibility

The vision sub-model is selected by `config.provider` and speaks mainstream API formats:

| `provider` | API | Example models | Config |
| --- | --- | --- | --- |
| `openai` | OpenAI-compatible `chat/completions` (`image_url` parts) | OpenAI `gpt-4o` / `gpt-4o-mini` / `gpt-4.1`; Qwen-VL (DashScope compatible mode); Zhipu GLM-4V; Moonshot; Mistral; xAI; local vLLM/Ollama gateways | `openai: { baseUrl, apiKey, model }` |
| `anthropic` | Anthropic Messages API (`image` base64 blocks) | Claude vision models, e.g. `claude-sonnet-4-5` | `anthropic: { baseUrl, apiKey, model }` |
| `gemini` | Google Gemini `generateContent` (`inline_data` parts) | `gemini-2.0-flash`, `gemini-2.5-flash` | `gemini: { baseUrl, apiKey, model }` |

An empty `baseUrl` uses the provider default (`https://api.openai.com/v1`, `https://api.anthropic.com`, `https://generativelanguage.googleapis.com/v1beta`). Any OpenAI-compatible endpoint works by pointing `openai.baseUrl` at it — this is how the plugin stays compatible with the mainstream model ecosystem without per-vendor SDKs.

### Load the plugin

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

### Configuration reference

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

### Tool contract

`vision_read(image, question?, model?)` — the UI render intent is `generic` (single question/answer round trip, no custom card).

- `image` (required): a local file path (absolute, or relative to the harness working directory), an http(s) URL (downloaded with the same timeout budget), or a `data:image/...;base64,...` URI. Supported formats: PNG, JPEG, WebP, GIF.
- `question`: what to ask about the image; defaults to the configured `defaultQuestion`.
- `model`: per-call vision-model override.
- Returns: the vision model's answer as text.

### Development

```sh
pnpm -C vision-plugin typecheck   # tsc over src + tests
pnpm -C vision-plugin test        # vitest, keyless (fetch is mocked)
```

Tests cover image resolution (data URI / path / URL, byte budgets), the three providers' wire requests and response parsing, HTTP error and timeout mapping, end-to-end tool execution, and an in-process Cordis composition check that `apply` registers and unregisters the tool.

### Known Limitations

- One image per call; the main model can call the tool repeatedly for several images.
- Non-streaming responses only — fine for a tool result.
- Image bytes are inlined as base64 into every provider request; no caching is attempted.
- Tests are keyless and mock `fetch`; a live call needs a real API key for the selected provider.
