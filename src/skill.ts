/**
 * The `vision-read` runtime skill: teaches the agent when to call the
 * `vision_read` tool, how to phrase the question with intent, and how to
 * verify the answer. Registered into the skills service when one is mounted.
 * @module vision-plugin/skill
 */

import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-skill'

/** The skill body: when to use, how to ask, how to verify. */
const SKILL_CONTENT = `# vision_read 使用指南 / vision_read playbook

## 何时使用 / When to use
Use the \`vision_read\` tool whenever the user's request involves an image the main model cannot see directly: describe it, answer questions about it, or extract text from it — photos, screenshots, diagrams, charts, scans, UI mockups.
当用户的问题涉及图片（照片、截图、图表、扫描件、UI 草图）而当前主模型无法直接看图时，调用 \`vision_read\`。

## 如何调用 / How to call
- \`image\`: 本地文件路径、http(s) URL 或 data: URI。
- \`question\`: 必填思路 —— 把当前任务真正需要知道的事情问出来，不要依赖默认的泛化描述。

## 提问要带意图 / Ask with intent
不要把 \`question\` 留空让视觉模型泛泛描述，除非你确实需要完整描述。具体的问题才产出可用的细节：
- 用户问"图里有什么文字" → "What text is visible in this image? Transcribe it exactly."
- 对比 UI/截图 → "Describe the layout, colors, and spacing of the header area."
- 图表 → "What trend does this chart show? List the axis labels and key data points."

## 验证 / Verify
- 把视觉模型回答中与任务相关的部分引用进你的回复，而不是只转述"这是一张图"。
- 回答含糊或不完整时，用更聚焦的 \`question\` 再调用一次。
- 文字提取类任务：把识别结果与图片来源对照；关键数字或术语不确定时，换一个角度再问一次确认。`

/**
 * Register the `vision-read` skill into a mounted skills registry.
 * Registrations are effects: the returned disposer unregisters on plugin
 * unload, and re-registration after a configuration change replaces the body.
 * @param skills - the mounted skills service.
 * @returns the Cordis effect disposer from the registry.
 */
export function registerVisionSkill(skills: SkillRegistry): () => void {
  return skills.register({
    name: 'vision-read',
    description: 'Read an image with the vision_read tool (a vision sub-model) when the main model cannot see images: describe, answer questions about, or extract text from an image.',
    whenToUse: 'The user asks about an image (photo, screenshot, diagram, chart, scan) or needs text from one, and the current model has no image input.',
    source: 'runtime',
    content: SKILL_CONTENT,
  })
}
