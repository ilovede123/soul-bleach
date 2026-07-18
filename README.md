# 灵境 / Soul Bleach

## 中文说明

灵境（Soul Bleach）是一个 VS Code 侧边栏智能体插件。它可以和 OpenAI 兼容格式的大模型对话，并通过工具调用读取、查看或写入当前工作区中的文件。

当前支持千问、智谱和自定义 OpenAI-compatible Chat Completions 接口。

### 功能特性

- 在 VS Code Activity Bar 中打开独立的「灵境」侧边栏。
- 与 AI 助手进行流式对话。
- 支持列出文件、搜索文件、搜索文本、分段读取、局部替换和写入文件。
- 支持上传 UI 图片，让支持视觉输入的模型分析和实现界面。
- 支持上传 DOCX、PPTX、XLSX、PDF、RTF、OpenDocument、EPUB 和常见 UTF-8 文本文件。
- 在输入框中输入 `@`，可以搜索并明确引用工作区文件。
- 复杂任务会创建执行计划；批量文件任务会展示真实文件清单和完成状态。
- 支持受限命令验证，例如编译、测试、lint 和只读 git 检查。
- 支持查看最近一次修改的 Diff，并在文件未被再次编辑时安全撤销。
- 可见聊天记录和模型上下文均按工作区恢复，并自动压缩较早内容。
- 支持停止正在生成的回复。
- 支持清空当前聊天记录。

### 使用要求

你需要准备一个兼容 OpenAI Chat Completions 格式的接口。如果接口需要鉴权，请填写 API Key；如果是无鉴权模型，可以留空。

千问默认接口地址：

```text
https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
```

智谱默认接口地址：

```text
https://api.z.ai/api/paas/v4/chat/completions
```

### 插件配置

插件提供以下 VS Code 设置项：

- `soul-bleach.provider`：模型服务商，可选 `qwen`、`zhipu-open`、`zhipu-coding`、`zai`、`custom`。
- `soul-bleach.modelPreset`：常用模型下拉框，可选跟随服务商、千问模型、`glm-5.2`、`glm-5.2[1m]`、`glm-5.1`、`glm-5`、`glm-4.7`、`glm-4.7-flash` 或自定义。
- `soul-bleach.baseUrl`：Chat Completions 完整接口地址。留空时使用 modelPreset 或 provider 的默认地址。
- `soul-bleach.model`：自定义模型名称。留空时使用 modelPreset 或 provider 的默认模型；填写后会覆盖下拉框选择。

API Key 不再以明文设置保存。请打开命令面板，运行 `灵境: 设置 API Key`；内网无鉴权服务无需设置。还可以运行 `灵境: 测试模型连接` 和 `灵境: 查看诊断日志` 排查接口问题。

### 智谱配置示例

如果使用智谱官方接口：

1. 如果使用普通开放平台 Key，将 `soul-bleach.provider` 设置为 `zhipu-open`。
2. 如果使用 GLM Coding Plan Key，将 `soul-bleach.provider` 设置为 `zhipu-coding`。
3. 将 `soul-bleach.modelPreset` 设置为 `glm-5.2` 或 `glm-4.7`，也可以保持跟随服务商。
4. 从命令面板运行 `灵境: 设置 API Key`。
5. `soul-bleach.baseUrl` 可以留空，插件会使用对应服务商默认地址。
6. `soul-bleach.model` 可以留空；如需其他支持 Function Calling 的 GLM 模型，再手动填写。

注意：插件里的 `baseUrl` 填的是完整请求地址，也就是包含 `/chat/completions` 的地址；这和 OpenAI SDK 示例中的 `baseURL` 根地址不是同一个概念。

目前公开文档中没有确认智谱存在 `glm-4.8` 模型；文档里出现的 4.8 多数是和 Claude Opus 4.8 的对比。插件因此没有内置 `glm-4.8` 预设，如需测试内部模型名，可以把 `modelPreset` 设为 `custom` 后手动填写 `soul-bleach.model`。

### 使用方式

1. 打开 VS Code 设置。
2. 搜索 `soul-bleach`。
3. 选择 `soul-bleach.provider`。
4. 选择 `soul-bleach.modelPreset`。
5. 按需填写 `soul-bleach.baseUrl` 和 `soul-bleach.model`，并通过命令面板安全设置 API Key。
6. 从 Activity Bar 打开「灵境」视图。
7. 输入问题，或让智能体查看当前工作区文件。

### 注意事项

智能体可以通过工具读取和写入当前工作区文件。请在保留生成结果前检查代码改动。

代码文件默认使用 `search_text` 定位关键行，再使用 `read_file_with_line_numbers` 分段读取片段，避免把大文件一次性放入模型上下文。

修改文件后，智能体会优先重新读取修改区域确认结果，并可使用受限的 `run_command` 执行 `pnpm run compile`、`pnpm run lint`、`pnpm run test`、`git diff --stat` 等验证命令。

模型上下文按当前工作区保存。图片 Base64 不会写入持久化状态，较早消息会按字符预算压缩成摘要。

### 更新记录

#### 1.0.0

完成编码闭环、附件上传、`@文件`、任务进度、上下文管理、原子写入、Diff、撤销和模型诊断。

---

## English

Soul Bleach, displayed as `灵境` in VS Code, is a sidebar assistant for chatting with an OpenAI-compatible model and letting it inspect or edit files in the current workspace.

The extension supports Qwen, Zhipu, and custom OpenAI-compatible Chat Completions endpoints.

### Features

- Open a dedicated `灵境` assistant view from the VS Code Activity Bar.
- Chat with an AI assistant using streamed responses.
- Let the assistant list files, search files, search text, read file ranges, and write files through tool calls.
- Upload UI images for vision-capable models, or upload DOCX, PPTX, XLSX, PDF, RTF, OpenDocument, EPUB, and UTF-8 text files.
- Type `@` to search for and reference workspace files explicitly.
- Track execution plans and deterministic per-file progress for batch tasks.
- Run restricted verification commands such as compile, test, lint, and read-only git checks.
- Review the latest changes in VS Code Diff and safely undo them when files have not changed again.
- Restore visible chat history and model context per workspace, with automatic context compaction.
- Stop an in-progress response.
- Clear the current chat history.

### Requirements

You need an OpenAI-compatible chat completions endpoint. If the endpoint requires authentication, set an API key. For unauthenticated internal endpoints, leave it empty.

The default Qwen endpoint is:

```text
https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
```

The default Zhipu endpoint is:

```text
https://api.z.ai/api/paas/v4/chat/completions
```

### Extension Settings

This extension contributes the following settings:

- `soul-bleach.provider`: Model provider. Supported values are `qwen`, `zhipu-open`, `zhipu-coding`, `zai`, and `custom`.
- `soul-bleach.modelPreset`: Common model dropdown. Supported values include provider default, Qwen models, `glm-5.2`, `glm-5.2[1m]`, `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.7-flash`, and custom.
- `soul-bleach.baseUrl`: Full Chat Completions endpoint. Leave it empty to use the selected model preset or provider default.
- `soul-bleach.model`: Custom model name. Leave it empty to use the selected model preset or provider default. When set, it overrides the dropdown selection.

API keys are stored with VS Code SecretStorage. Run `灵境: 设置 API Key` from the Command Palette. Unauthenticated internal endpoints do not require a key. Use `灵境: 测试模型连接` and `灵境: 查看诊断日志` for troubleshooting.

### Zhipu Configuration

To use the official Zhipu API:

1. Use `zhipu-open` for a regular Zhipu Open Platform key.
2. Use `zhipu-coding` for a GLM Coding Plan key.
3. Set `soul-bleach.modelPreset` to `glm-5.2` or `glm-4.7`, or keep provider default.
4. Run `灵境: 设置 API Key` from the Command Palette.
5. Leave `soul-bleach.baseUrl` empty to use the built-in endpoint.
6. Leave `soul-bleach.model` empty, or set another GLM model that supports Function Calling.

Note: the extension expects a full request endpoint in `baseUrl`, including `/chat/completions`. This differs from the `baseURL` root used in OpenAI SDK examples.

No public Zhipu `glm-4.8` model was confirmed in the current documentation. Mentions of 4.8 usually refer to Claude Opus 4.8 comparisons. Use the custom model field if you need to test an internal model name.

### Usage

1. Open VS Code settings.
2. Search for `soul-bleach`.
3. Choose `soul-bleach.provider`.
4. Choose `soul-bleach.modelPreset`.
5. Fill in `soul-bleach.baseUrl` and `soul-bleach.model` as needed, then set the API key from the Command Palette.
6. Open the `灵境` view from the Activity Bar.
7. Ask the assistant a question or request a workspace file inspection.

### Notes

The assistant can read and write files in the open workspace through its tools. Review generated changes before keeping them.

Code files are usually handled by locating key lines with `search_text` first, then reading focused ranges with `read_file_with_line_numbers`.

After edits, the assistant should reread the changed range and can use the restricted `run_command` tool for commands such as `pnpm run compile`, `pnpm run lint`, `pnpm run test`, and `git diff --stat`.

Model context is stored per workspace. Image Base64 is not persisted, and older messages are compacted into a summary when the character budget is reached.

### Release Notes

#### 1.0.0

Adds the complete coding loop, attachments, `@file`, task progress, context management, atomic writes, Diff, undo, and model diagnostics.
