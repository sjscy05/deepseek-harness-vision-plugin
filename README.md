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

视觉子模型由 `config.provider` 选择，内置六家主流厂商，切换只需改一行：

| `provider` | API | 默认模型 | 端点（可覆盖） | key 环境变量 |
| --- | --- | --- | --- | --- |
| `zhipu` | OpenAI 兼容 `chat/completions` | `glm-4v-flash`（免费；`glm-4v-plus` 更强） | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` |
| `qwen` | OpenAI 兼容 `chat/completions` | `qwen-vl-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `QWEN_API_KEY` |
| `doubao` | OpenAI 兼容 `chat/completions` | `doubao-1.5-vision-pro-32k-250115` | `https://ark.cn-beijing.volces.com/api/v3` | `ARK_API_KEY` |
| `openai` | OpenAI 兼容 `chat/completions` | `gpt-4o-mini` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `anthropic` | Anthropic Messages API（base64 `image` 块） | `claude-sonnet-4-5` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `gemini` | Google Gemini `generateContent`（`inline_data` 部分） | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` |

zhipu / qwen / doubao / openai 共用 OpenAI 兼容协议；任意 OpenAI 兼容网关（本地 vLLM/Ollama、Moonshot、Mistral、xAI 等）都可以通过 `openai.baseUrl` 接入——无需任何厂商 SDK。

### 加载插件

在 deepseek-harness 仓库根目录执行：

```sh
pnpm dsh --profile web --patch ./vision-plugin/cordis.yml
```

patch overlay 已把六个厂商的配置块全部预置，**API key 一律不写在 cordis.yml 里**，插件自动从仓库根目录的 `.env` 读取所选厂商对应的环境变量。`.env` 已被 gitignore，不会提交；`cordis.yml` 会随仓库公开，请勿把 key 写进去。

```yaml
- insert:
    - id: vision
      # 路径必须为绝对路径；Windows 下必须使用 file:/// URL 形式
      # （ESM loader 拒绝裸盘符路径）。
      name: 'file:///D:/deepseek-harness/vision-plugin/src/index.ts'
      config:
        # 切换视觉厂商 = 改这一行
        provider: zhipu
        zhipu:
          model: 'glm-4v-flash'
        qwen:
          model: 'qwen-vl-plus'
        # ...其余厂商块同理，可删掉不用的
```

对应 `.env` 示例：

```
ZHIPU_API_KEY=你的智谱key
# QWEN_API_KEY=...
# ARK_API_KEY=...
```

所选厂商的配置块必须带有非空的 `model`，key 必须存在于 `.env`（或块内显式 `apiKey:` 覆盖）；缺失时插件加载会直接报出可操作的错误（绝不会静默回退）。

### 配置参考

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `provider` | `openai` \| `zhipu` \| `qwen` \| `doubao` \| `anthropic` \| `gemini` | `openai` | 服务 `vision_read` 调用的视觉厂商；切换只需改这一行 |
| `<provider>.baseUrl` | string | 各厂商默认端点 | API 端点基地址（任意 OpenAI 兼容网关可用 `openai` 块接入） |
| `<provider>.apiKey` | string | 厂商对应 env 变量 | 密钥；留空自动读 `.env`（如 `ZHIPU_API_KEY`），块内显式填写可覆盖 |
| `<provider>.model` | string | 必填 | 视觉模型 id |
| `<provider>.maxTokens` | number | `1024` | 生成 token 的上限 |
| `timeoutMs` | number | `60000` | 图片下载与 provider 调用的总超时（毫秒） |
| `maxImageBytes` | number | `10485760` | 解码后图片字节上限（10 MiB） |
| `defaultQuestion` | string | 详细描述提示词 | 调用未传 `question` 时使用的默认问题 |
| `maxOutputChars` | number | `20000` | 返回给主模型的回答文本上限 |

### 工具契约

`vision_read(image, question?, model?)` — UI 呈现意图为 `generic`（单次问答往返，无自定义卡片）。

- `image`（必填）：本地文件路径（绝对路径，或相对 harness 工作目录的路径）、http(s) URL（按同一超时预算下载）、或 `data:image/...;base64,...` URI。支持格式：PNG、JPEG、WebP、GIF。
- `question`：针对图片的**具体问题**——从用户请求或当前任务的需要出发，带上意图（如"What text is visible?"、"Describe the chart's trend"），而不是让视觉模型泛泛描述；只有确实需要完整描述时才省略。缺省使用配置的 `defaultQuestion`。
- `model`：单次调用的视觉模型覆盖。
- 返回：视觉模型的回答文本。

### 内置 skill：vision-read

插件在 skills 服务存在时自动注册 `vision-read` skill（无需额外安装，卸载插件即随之移除）。skill 指导主模型：

- **何时调用**：用户的问题涉及图片（照片、截图、图表、扫描件、UI 草图）而主模型无法直接看图时
- **如何带意图提问**：把当前任务真正需要知道的事情问出来，不依赖默认泛化描述；给出中英文示例
- **如何验证**：把与任务相关的回答引用进回复；回答含糊时用更聚焦的问题再调一次；文字提取与来源对照确认

### 开发

```sh
pnpm -C vision-plugin typecheck   # tsc 检查 src + scripts + tests
pnpm -C vision-plugin test        # vitest，无需密钥（fetch 为 mock）
```

测试覆盖图片解析（data URI / 路径 / URL，字节上限）、三家 provider 的请求构建与响应解析、HTTP 错误与超时映射、工具端到端执行，以及进程内 Cordis 组合检查（`apply` 注册与注销工具）。

### 直连 API 冒烟测试

无需启动 harness，直接用真实视觉 API 验证插件的数据通路。**在 deepseek-harness 检出目录内运行**（插件依赖 harness 的依赖树解析 `@deepseek-ai/*`，独立复制出来的目录没有这些依赖）；脚本会自动读取仓库根目录的 `.env`，所以**只要 `.env` 里填了 key，什么都不用设**：

```powershell
cd D:\deepseek-harness
pnpm -C vision-plugin test:direct          # 默认 zhipu / glm-4v-flash
$env:PROVIDER = 'qwen'; pnpm -C vision-plugin test:direct   # 换厂商
$env:MODEL = 'glm-4v-plus'; pnpm -C vision-plugin test:direct  # 换模型
$env:IMAGE = 'D:/xx/photo.png'; pnpm -C vision-plugin test:direct  # 换图片（路径/URL/data URI）
```

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

The vision sub-model is selected by `config.provider` — six mainstream vendors are built in, switching is one line:

| `provider` | API | Default model | Endpoint (overridable) | Key env var |
| --- | --- | --- | --- | --- |
| `zhipu` | OpenAI-compatible `chat/completions` | `glm-4v-flash` (free; `glm-4v-plus` is stronger) | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` |
| `qwen` | OpenAI-compatible `chat/completions` | `qwen-vl-plus` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `QWEN_API_KEY` |
| `doubao` | OpenAI-compatible `chat/completions` | `doubao-1.5-vision-pro-32k-250115` | `https://ark.cn-beijing.volces.com/api/v3` | `ARK_API_KEY` |
| `openai` | OpenAI-compatible `chat/completions` | `gpt-4o-mini` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `anthropic` | Anthropic Messages API (`image` base64 blocks) | `claude-sonnet-4-5` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `gemini` | Google Gemini `generateContent` (`inline_data` parts) | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` |

zhipu / qwen / doubao / openai share the OpenAI-compatible protocol; any OpenAI-compatible gateway (local vLLM/Ollama, Moonshot, Mistral, xAI, …) can be reached through the `openai` block's `baseUrl` — no per-vendor SDKs.

### Load the plugin

From the repository root:

```sh
pnpm dsh --profile web --patch ./vision-plugin/cordis.yml
```

The patch overlay preconfigures all six vendor blocks. **API keys never appear in `cordis.yml`** — the plugin reads the selected vendor's key from the repo-root `.env` (gitignored) automatically. Never write a key into `cordis.yml`; that file ships with the public repository.

```yaml
- insert:
    - id: vision
      # Must be absolute; on Windows use the file:/// URL form (the ESM
      # loader rejects bare drive-letter paths).
      name: 'file:///D:/deepseek-harness/vision-plugin/src/index.ts'
      config:
        # Switching vision vendors = change this one line
        provider: zhipu
        zhipu:
          model: 'glm-4v-flash'
        qwen:
          model: 'qwen-vl-plus'
        # ...same for the other blocks; delete the ones you don't use
```

Corresponding `.env` example:

```
ZHIPU_API_KEY=your-zhipu-key
# QWEN_API_KEY=...
# ARK_API_KEY=...
```

The selected vendor's block must carry a non-empty `model`, and its key must exist in `.env` (or be overridden by an explicit `apiKey:` in the block); missing configuration fails the plugin load with an actionable error (never a silent fallback).

### Configuration reference

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `provider` | `openai` \| `zhipu` \| `qwen` \| `doubao` \| `anthropic` \| `gemini` | `openai` | Vision vendor serving `vision_read` calls; switch by changing this one line |
| `<provider>.baseUrl` | string | per-vendor default | API endpoint base (any OpenAI-compatible gateway via the `openai` block) |
| `<provider>.apiKey` | string | vendor env var | Secret; leave empty to read the vendor's env var from `.env` (e.g. `ZHIPU_API_KEY`), set explicitly to override |
| `<provider>.model` | string | required | Vision model id |
| `<provider>.maxTokens` | number | `1024` | Provider-side cap on generated tokens |
| `timeoutMs` | number | `60000` | Wall-clock budget for image download and the provider call |
| `maxImageBytes` | number | `10485760` | Upper bound on decoded image bytes (10 MiB) |
| `defaultQuestion` | string | detailed-description prompt | Question used when a call omits `question` |
| `maxOutputChars` | number | `20000` | Cap on answer text returned to the main model |

### Tool contract

`vision_read(image, question?, model?)` — the UI render intent is `generic` (single question/answer round trip, no custom card).

- `image` (required): a local file path (absolute, or relative to the harness working directory), an http(s) URL (downloaded with the same timeout budget), or a `data:image/...;base64,...` URI. Supported formats: PNG, JPEG, WebP, GIF.
- `question`: the **specific question** about the image — phrased from the user's request or the current task's need (e.g. "What text is visible?", "Describe the chart's trend"), not a generic "describe this"; omit it only when a full general description is genuinely wanted. Defaults to the configured `defaultQuestion`.
- `model`: per-call vision-model override.
- Returns: the vision model's answer as text.

### Built-in skill: vision-read

When a skills service is mounted, the plugin auto-registers the `vision-read` skill (no extra install; it disappears with the plugin on unload). The skill teaches the main model:

- **When to call**: the user's request involves an image (photo, screenshot, diagram, chart, scan, UI mockup) and the current model has no image input.
- **How to ask with intent**: ask what the current task actually needs, instead of falling back to a generic description — with bilingual examples.
- **How to verify**: quote the task-relevant parts of the answer; re-call with a more focused question when the answer is vague; cross-check extracted text against the image source.

### Development

```sh
pnpm -C vision-plugin typecheck   # tsc over src + scripts + tests
pnpm -C vision-plugin test        # vitest, keyless (fetch is mocked)
```

Tests cover image resolution (data URI / path / URL, byte budgets), the three providers' wire requests and response parsing, HTTP error and timeout mapping, end-to-end tool execution, and an in-process Cordis composition check that `apply` registers and unregisters the tool.

### Direct API smoke test

Verify the plugin's data path against a real vision API without booting the harness. **Run inside the deepseek-harness checkout** (the plugin resolves `@deepseek-ai/*` through the harness dependency tree; a standalone copy has no such dependencies). The script loads the repo-root `.env` itself, so **nothing needs setting once the key is in `.env`**:

```powershell
cd D:\deepseek-harness
pnpm -C vision-plugin test:direct                              # default: zhipu / glm-4v-flash
$env:PROVIDER = 'qwen';  pnpm -C vision-plugin test:direct     # switch vendor
$env:MODEL = 'glm-4v-plus';  pnpm -C vision-plugin test:direct # switch model
$env:IMAGE = 'D:/xx/photo.png';  pnpm -C vision-plugin test:direct  # other image (path / URL / data URI)
```

### Known Limitations

- One image per call; the main model can call the tool repeatedly for several images.
- Non-streaming responses only — fine for a tool result.
- Image bytes are inlined as base64 into every provider request; no caching is attempted.
- Tests are keyless and mock `fetch`; a live call needs a real API key for the selected provider.
