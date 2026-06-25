import * as vscode from "vscode";

export function getConfig() {
    const config = vscode.workspace.getConfiguration('soul-bleach');
    const baseUrl = config.get<string>('baseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    const apiKey = config.get<string>('apiKey', '');
    const model = config.get<string>('model');
    return { baseUrl, apiKey, model };
}

export async function completion(messages: any[], tools: any[], onChunk?: (text: string) => void, signal?: AbortSignal): Promise<any> {
    const { baseUrl, apiKey, model } = getConfig();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };

    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(baseUrl, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify({
            model,
            messages,
            tools,
            tool_choice: 'auto',
            // 这里开启流式输出。开启后接口返回的不是一个完整 JSON，
            // 而是一段一段的 SSE 文本，例如：
            // data: {"choices":[{"delta":{"content":"你好"}}]}
            // data: {"choices":[{"delta":{"tool_calls":[...]}}]}
            stream: true,
            enable_thinking: false
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
        throw new Error('API response body is empty.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // fullMessage 是把“流式碎片”重新拼成 OpenAI/DashScope message 的地方。
    // 普通聊天时，模型会不断返回 delta.content，所以 content 会逐步变长。
    // 读取文件时，模型第一轮通常不会返回 content，而是返回 tool_calls，
    // 所以这里必须同时保存 content 和 tool_calls，否则后续 agent 不知道要执行哪个工具。
    const fullMessage: any = { role: 'assistant', content: '' };
    const thinkFilter = createThinkFilter(onChunk);

    // SSE 的一行 JSON 可能会被网络切成两半：
    // 第一次 reader.read() 拿到半行，第二次才拿到剩下半行。
    // 如果直接 chunk.split('\n') 并立刻 JSON.parse，半行 JSON 会解析失败并被丢掉。
    // buffer 用来保存“还没凑成完整一行”的残留文本，等下一块数据来了再一起解析。
    let buffer = '';

    while (true) {
        if (signal?.aborted) {
            throw createAbortError();
        }

        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);

        // split 后最后一段可能不是完整 SSE 行，先留在 buffer 里。
        // 只有前面的完整行才交给 parseSseLine 处理。
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            parseSseLine(line, fullMessage, thinkFilter.handleText);
        }
    }

    // 流结束时把 TextDecoder 里可能缓存的最后几个字节冲出来。
    buffer += decoder.decode();
    if (buffer) {
        parseSseLine(buffer, fullMessage, thinkFilter.handleText);
    }

    if (!fullMessage.content) {
        // 如果这一轮只有工具调用，没有正文，就不要返回空 content。
        // 这样 agent.ts 可以明确判断：这一轮要先执行工具，再继续问模型。
        delete fullMessage.content;
    } else {
        fullMessage.content = stripThinkBlocks(fullMessage.content);
    }

    return fullMessage;
}

function stripThinkBlocks(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trimStart();
}

function createThinkFilter(onChunk?: (text: string) => void) {
    let buffer = '';
    let isThinking = false;

    return {
        handleText(text: string) {
            buffer += text;

            while (buffer.length > 0) {
                if (isThinking) {
                    const thinkEnd = buffer.indexOf('</think>');
                    if (thinkEnd === -1) {
                        const keepLength = Math.min(buffer.length, '</think>'.length - 1);
                        buffer = buffer.slice(Math.max(0, buffer.length - keepLength));
                        return;
                    }

                    buffer = buffer.slice(thinkEnd + '</think>'.length);
                    isThinking = false;
                    continue;
                }

                const thinkStart = buffer.indexOf('<think>');
                if (thinkStart === -1) {
                    const keepLength = Math.min(buffer.length, '<think>'.length - 1);
                    const emitLength = buffer.length - keepLength;

                    if (emitLength > 0) {
                        onChunk?.(buffer.slice(0, emitLength));
                        buffer = buffer.slice(emitLength);
                    }

                    return;
                }

                if (thinkStart > 0) {
                    onChunk?.(buffer.slice(0, thinkStart));
                }

                buffer = buffer.slice(thinkStart + '<think>'.length);
                isThinking = true;
                onChunk?.('__SOUL_BLEACH_THINKING__');
            }
        }
    };
}

function createAbortError(): Error {
    const error = new Error('Request aborted.');
    error.name = 'AbortError';
    return error;
}

function parseSseLine(line: string, fullMessage: any, onChunk?: (text: string) => void) {
    // DashScope/OpenAI 兼容接口的流式响应是 SSE 格式，
    // 真正的数据行都以 data: 开头，其他空行或事件行可以忽略。
    if (!line.startsWith('data: ')) {
        return;
    }

    const jsonStr = line.slice(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') {
        // [DONE] 只是告诉我们流结束，不包含模型内容。
        return;
    }

    let parsed: any;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        // 如果这里偶发解析失败，通常说明服务端返回了非 JSON 行。
        // 完整行被 buffer 保护后，正常的半包 JSON 不会走到这里。
        return;
    }

    const choice = parsed.choices?.[0];
    const delta = choice?.delta;

    if (delta?.content) {
        // 普通对话主要走这里：
        // 模型每吐出一小段文字，就累加到 fullMessage.content，
        // 同时通过 onChunk 推给 webview，所以前端能边生成边显示。
        fullMessage.content += delta.content;
        onChunk?.(delta.content);
    }

    if (delta?.reasoning_content) {
        // 有些模型会把思考内容放在 reasoning_content。
        // 这里不展示也不保存，避免把思考过程混入最终回答。
        onChunk?.('__SOUL_BLEACH_THINKING__');
    }

    if (delta?.tool_calls) {
        // 让模型“查看文件”时，关键区别就在这里：
        // 第一轮 assistant message 往往不是文字回答，而是 tool_calls，
        // 意思是“我要调用 read_file/list_files 这个工具”。
        //
        // 这类 delta 不会触发 onChunk，因为它不是要展示给用户的正文。
        // 前端此时可能只看到一个空的流式气泡，直到工具执行完、
        // agent.ts 再发起下一轮模型请求，模型才会返回最终总结文字。
        fullMessage.tool_calls ??= [];

        for (const tc of delta.tool_calls) {
            const index = tc.index ?? fullMessage.tool_calls.length;

            // tool_calls 也是流式返回的：
            // 第一段可能只有 id/name，后续多段才逐步返回 arguments。
            // 所以必须按 index 找到同一个工具调用，然后不断拼接 arguments。
            fullMessage.tool_calls[index] ??= {
                id: tc.id,
                type: 'function',
                function: { name: tc.function?.name, arguments: '' }
            };

            if (tc.id) {
                fullMessage.tool_calls[index].id = tc.id;
            }

            if (tc.function?.name) {
                fullMessage.tool_calls[index].function.name = tc.function.name;
            }

            if (tc.function?.arguments) {
                // arguments 经常会被切成多段，例如：
                // 第 1 段: {"path":
                // 第 2 段: "src/agent.ts"}
                // 不拼接的话 JSON.parse(rawArgs) 会失败，工具也就无法执行。
                fullMessage.tool_calls[index].function.arguments += tc.function.arguments;
            }
        }
    }

    if (choice?.finish_reason) {
        // finish_reason === 'tool_calls' 表示这一轮结束原因是“模型要调用工具”；
        // finish_reason === 'stop' 通常表示最终文字回答已经结束。
        fullMessage.finish_reason = choice.finish_reason;
    }
}
