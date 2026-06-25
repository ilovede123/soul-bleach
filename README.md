# 灵境 / Soul Bleach

## 中文说明

灵境（Soul Bleach）是一个 VS Code 侧边栏智能体插件。它可以和 OpenAI 兼容格式的大模型对话，并通过工具调用读取、查看或写入当前工作区中的文件。

当前默认面向 DashScope 兼容的 Chat Completions API，可用于 Qwen 系列模型。

### 功能特性

- 在 VS Code Activity Bar 中打开独立的「灵境」侧边栏。
- 与 AI 助手进行流式对话。
- 支持让模型通过工具调用列出文件、读取文件、写入文件。
- Webview 重新加载后保留可见聊天记录。
- 支持停止正在生成的回复。
- 支持清空当前聊天记录。

### 使用要求

你需要准备一个兼容 OpenAI Chat Completions 格式的接口。如果接口需要鉴权，请填写 API Key；如果是无鉴权模型，可以留空。

默认接口地址：

```text
https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
```

### 插件配置

插件提供以下 VS Code 设置项：

- `soul-bleach.baseUrl`：模型接口地址。
- `soul-bleach.apiKey`：API Key。填写后会作为 `Authorization: Bearer ...` 请求头发送；无鉴权模型可以留空。
- `soul-bleach.model`：模型名称，例如 `qwen-plus` 或其他兼容模型。

### 使用方式

1. 打开 VS Code 设置。
2. 搜索 `soul-bleach`。
3. 填写 `soul-bleach.apiKey`。
4. 从 Activity Bar 打开「灵境」视图。
5. 输入问题，或让智能体查看当前工作区文件。

### 注意事项

智能体可以通过工具读取和写入当前工作区文件。请在保留生成结果前检查代码改动。

当前聊天历史主要用于恢复侧边栏中可见的对话记录，暂未实现跨会话的长期模型记忆。

### 更新记录

#### 0.0.10

增加搜索文件功能search_file

初始开发版本。

---

## English

Soul Bleach, displayed as `灵境` in VS Code, is a sidebar assistant for chatting with an OpenAI-compatible model and letting it inspect or edit files in the current workspace.

The extension currently targets DashScope-compatible chat completion APIs and is configured by default for the Qwen model family.

### Features

- Open a dedicated `灵境` assistant view from the VS Code Activity Bar.
- Chat with an AI assistant using streamed responses.
- Let the assistant list workspace files, read files, and write files through tool calls.
- Preserve visible chat history while the webview is reloaded.
- Stop an in-progress response.
- Clear the current chat history.

### Requirements

You need an OpenAI-compatible chat completions endpoint. If the endpoint requires authentication, set an API key. For unauthenticated internal endpoints, leave it empty.

The default endpoint is:

```text
https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
```

### Extension Settings

This extension contributes the following settings:

- `soul-bleach.baseUrl`: Chat completions API endpoint.
- `soul-bleach.apiKey`: Optional API key. When set, it is sent as the `Authorization: Bearer ...` request header. Leave it empty for unauthenticated internal endpoints.
- `soul-bleach.model`: Model name, for example `qwen-plus` or another compatible model.

### Usage

1. Open VS Code settings.
2. Search for `soul-bleach`.
3. Fill in `soul-bleach.apiKey`.
4. Open the `灵境` view from the Activity Bar.
5. Ask the assistant a question or request a workspace file inspection.

### Notes

The assistant can read and write files in the open workspace through its tools. Review generated changes before keeping them.

Chat history currently preserves the visible sidebar conversation state. Long-term model memory across sessions is not enabled yet.

### Release Notes

#### 0.0.1

Initial development release.
