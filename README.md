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
- 支持一次性原子应用多段文本补丁，并通过文件哈希避免基于旧内容覆盖新修改。
- 修改完成后由程序自动执行编译、lint、测试，并交给隔离上下文的审查器复核。
- 长任务会保存运行状态；VS Code 重启后可以继续未完成任务或主动丢弃。
- 支持项目结构、工作区符号、诊断信息和分层 `AGENTS.md` 指令读取。
- 支持只读子智能体并行调查、Git 分支/提交/推送/PR，以及可配置 MCP stdio 工具。
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
- `soul-bleach.permissionMode`：工具权限，可选只读、工作区写入和逐次询问。它是扩展内审批，不是操作系统沙箱。
- `soul-bleach.mcpServers`：MCP stdio 服务器配置。修改后运行 `灵境: 重新加载 MCP 服务器`。

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

### 附件与文件引用

- 点击输入框旁的附件按钮可以上传图片或文档。单次最多上传 4 张图片和 4 个文档。
- 单张图片最大 6MB。图片会通过 OpenAI-compatible 多模态消息发送，因此所选模型必须支持视觉输入。
- 单个文档最大 10MB。支持 DOCX、PPTX、XLSX、PDF、RTF、ODT、ODP、ODS、EPUB，以及常见代码和 UTF-8 文本格式。
- 旧版二进制 Office 文件 `.doc`、`.ppt`、`.xls` 暂不支持，请先另存为新版格式。
- 文档在本地提取文本后再发送给模型，单次附件提取文本总量最多约 90000 字符，超出部分会截断或提示拆分上传。
- 在输入框中输入 `@` 和文件名可以搜索当前工作区。选中后，文件路径会作为明确引用交给智能体，适合用户已经知道目标文件但不想输入完整路径的场景。

### 上下文持久化与压缩

灵境同时维护两种状态：Webview 中可见的聊天气泡，以及真正发送给模型的 `user`、`assistant`、`tool` 消息。模型上下文使用 VS Code `workspaceState` 按工作区保存，因此重新打开 VS Code 或切换项目后，每个项目会恢复自己的会话。

- 每次任务成功、失败或被停止后，都会保存当前模型上下文。
- 恢复时会重新加载当前版本的系统提示词，不会继续使用旧版本保存的系统提示词。
- 图片 Base64 不会写入持久化状态，只记录历史消息中曾上传的图片数量。
- API Key 不属于对话上下文，始终单独保存在 VS Code SecretStorage 中。
- 当上下文超过 42 条消息或约 90000 字符时，较早消息会被整理成不超过 6000 字符的规则摘要。
- 压缩后保留系统提示词、历史摘要和最近消息；最近消息最多保留 24 条，并控制在约 55000 字符内。
- 当前使用规则式摘要，不会额外调用一次模型，因此不会产生额外 API 费用。字符预算是 Token 数量的近似值，不等同于精确 Tokenizer 统计。

点击“清空聊天记录”会同时清除当前工作区的可见聊天记录和模型上下文。

### 多智能体与任务恢复

主智能体只会在复杂、批量、审查或架构类任务中看到 `delegate_tasks`。它可以把最多 3 个互相独立的调查任务并行交给 `explorer`、`tester` 或 `reviewer`，子智能体只拥有读取、搜索、诊断和只读验证工具，不能写文件、启动后台服务或提交 Git。

每个子智能体只接收“角色约束 + 主任务 + 自己的子任务”，不会复制主会话的全部历史。它们通过工具结果把摘要返回主智能体，最终修改、验证和答复仍由主智能体统一负责。详细流程和上下文边界见 [`docs/AGENT_RUNTIME.md`](docs/AGENT_RUNTIME.md)。

运行中的计划、循环轮次、文件清单、已修改文件、验证记录和子智能体状态会持续写入当前工作区的 `workspaceState`。异常退出或停止后，面板会显示继续/丢弃入口；继续执行不会重新创建计划，也不会把已经完成的文件重新标成待处理。

主智能体每次开始或继续任务拥有 80 轮执行预算；子智能体使用各自独立的最多 12 轮预算，不会累加到主循环。主任务达到单次预算后会暂停并保存现场，点击“继续任务”即可获得下一段预算。思考过程超过固定高度后在区域内部滚动，不会持续撑高对话气泡。

### MCP 配置示例

```json
{
  "soul-bleach.mcpServers": [
    {
      "name": "example",
      "command": "npx",
      "args": ["-y", "your-mcp-server"],
      "env": {
        "EXAMPLE_TOKEN": "${env:EXAMPLE_TOKEN}"
      },
      "enabled": true
    }
  ]
}
```

MCP 工具会以 `mcp__服务名__工具名` 暴露给模型，每次调用都需要用户确认。服务器连接超过 10 秒会中止并写入诊断信息，避免扩展启动一直等待。

### 注意事项

智能体可以通过工具读取和写入当前工作区文件。请在保留生成结果前检查代码改动。

代码文件默认使用 `search_text` 定位关键行，再使用 `read_file_with_line_numbers` 分段读取片段，避免把大文件一次性放入模型上下文。

修改文件后，智能体会优先重新读取修改区域确认结果，并可使用受限的 `run_command` 执行 `pnpm run compile`、`pnpm run lint`、`pnpm run test`、`git diff --stat` 等验证命令。

上下文的保存范围、隐私边界和压缩阈值请查看上面的“上下文持久化与压缩”章节。

### 更新记录

#### 1.1.0

增加原子多段补丁、运行恢复、确定性验证、独立审查、代码索引、分层指令、权限审批、后台进程、Git 工作流、MCP 和只读多智能体协作。

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
- Apply multiple text edits atomically with stale-file hash protection.
- Run deterministic validation and an isolated review before completion.
- Resume interrupted runs with persisted plans, file tasks, validations, and subagent state.
- Use project maps, workspace symbols, diagnostics, hierarchical `AGENTS.md`, Git workflows, MCP tools, and read-only parallel subagents.
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
- `soul-bleach.permissionMode`: Read-only, workspace-write, or per-write approval. This is extension-level approval rather than an operating-system sandbox.
- `soul-bleach.mcpServers`: MCP stdio server definitions. Run `灵境: 重新加载 MCP 服务器` after changing them.

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

### Attachments And File References

- Use the attachment button next to the input to upload images or documents. One request supports up to four images and four documents.
- Each image can be up to 6MB. Images are sent as OpenAI-compatible multimodal messages, so the selected model must support vision input.
- Each document can be up to 10MB. Supported formats include DOCX, PPTX, XLSX, PDF, RTF, ODT, ODP, ODS, EPUB, and common UTF-8 text or source-code files.
- Legacy binary Office files (`.doc`, `.ppt`, and `.xls`) are not supported. Save them in a modern format before uploading.
- Documents are parsed locally before their extracted text is sent to the model. Extracted attachment text is limited to roughly 90,000 characters per request.
- Type `@` followed by a filename to search the current workspace. Selecting a result gives the assistant an explicit path instead of requiring it to guess the target file.

### Context Persistence And Compaction

Soul Bleach maintains both the visible Webview conversation and the actual `user`, `assistant`, and `tool` messages sent to the model. Model context is stored with VS Code `workspaceState`, scoped to the current workspace.

- Context is saved after a task succeeds, fails, or is stopped.
- The latest system prompt is recreated when context is restored, so an outdated saved system prompt is not reused after an extension update.
- Image Base64 data is never persisted; only the number of previously uploaded images is recorded.
- API keys are stored separately in VS Code SecretStorage and are never part of the conversation state.
- Compaction starts when history exceeds 42 messages or approximately 90,000 characters.
- Older messages become a rule-based summary of up to 6,000 characters. Up to 24 recent messages are retained within a roughly 55,000-character budget.
- Compaction does not call another model and therefore adds no API request. Character limits are an approximation rather than exact tokenizer counts.

Clearing chat history removes both the visible conversation and the persisted model context for the current workspace.

### Multi-agent Runs And Recovery

For complex work, the main agent can delegate up to three independent read-only investigations to explorer, tester, or reviewer roles. Each child receives only its role, the parent task, and its own assignment. Child summaries return through the tool result; only the main agent owns edits, final validation, and the answer. See [`docs/AGENT_RUNTIME.md`](docs/AGENT_RUNTIME.md) for the detailed architecture.

Plans, iterations, file tasks, changed files, validations, and subagent activity are stored in workspace-scoped state. Interrupted work can be continued or discarded from the panel.

### Notes

The assistant can read and write files in the open workspace through its tools. Review generated changes before keeping them.

Code files are usually handled by locating key lines with `search_text` first, then reading focused ranges with `read_file_with_line_numbers`.

After edits, the assistant should reread the changed range and can use the restricted `run_command` tool for commands such as `pnpm run compile`, `pnpm run lint`, `pnpm run test`, and `git diff --stat`.

See “Context Persistence And Compaction” above for storage scope, privacy boundaries, and compaction thresholds.

### Release Notes

#### 1.1.0

Adds atomic multi-edit patches, run recovery, deterministic validation, isolated review, code intelligence, repository guidance, permission gates, background processes, Git workflows, MCP, and read-only parallel subagents.

#### 1.0.0

Adds the complete coding loop, attachments, `@file`, task progress, context management, atomic writes, Diff, undo, and model diagnostics.
