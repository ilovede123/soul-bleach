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

    const fullMessage: any = { role: 'assistant', content: '' };
    const thinkFilter = createThinkFilter(onChunk);

    // SSE 可能从任意位置断开，先缓存半行，等下一块数据补齐后再解析。
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

        buffer = lines.pop() ?? '';

        for (const line of lines) {
            parseSseLine(line, fullMessage, thinkFilter.handleText);
        }
    }

    buffer += decoder.decode();
    if (buffer) {
        parseSseLine(buffer, fullMessage, thinkFilter.handleText);
    }
    thinkFilter.flush();

    if (!fullMessage.content) {
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
                    const keepLength = getThinkPrefixLength(buffer);
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
        },
        flush() {
            if (!isThinking && buffer.length > 0) {
                onChunk?.(buffer);
            }
            buffer = '';
        }
    };
}

function getThinkPrefixLength(text: string): number {
    const tag = '<think>';
    const maxLength = Math.min(text.length, tag.length - 1);

    for (let length = maxLength; length > 0; length--) {
        if (tag.startsWith(text.slice(-length))) {
            return length;
        }
    }

    return 0;
}

function createAbortError(): Error {
    const error = new Error('Request aborted.');
    error.name = 'AbortError';
    return error;
}

function parseSseLine(line: string, fullMessage: any, onChunk?: (text: string) => void) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
        return;
    }

    const jsonStr = trimmedLine.startsWith('data:')
        ? trimmedLine.replace(/^data:\s*/, '').trim()
        : trimmedLine;

    if (!jsonStr || jsonStr === '[DONE]') {
        return;
    }

    if (!jsonStr.startsWith('{')) {
        return;
    }

    let parsed: any;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        return;
    }

    const choice = parsed.choices?.[0];
    const delta = choice?.delta ?? choice?.message;

    if (delta?.content) {
        fullMessage.content += delta.content;
        onChunk?.(delta.content);
    }

    if (delta?.reasoning_content) {
        onChunk?.('__SOUL_BLEACH_THINKING__');
    }

    if (delta?.tool_calls) {
        fullMessage.tool_calls ??= [];

        for (const tc of delta.tool_calls) {
            const index = resolveToolCallIndex(fullMessage.tool_calls, tc);

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

            if (tc.function?.arguments !== undefined) {
                fullMessage.tool_calls[index].function.arguments += stringifyToolArguments(tc.function.arguments);
            }
        }
    }

    if (choice?.finish_reason) {
        fullMessage.finish_reason = choice.finish_reason;
    }
}

function resolveToolCallIndex(toolCalls: any[], toolCall: any): number {
    if (typeof toolCall.index === 'number') {
        return toolCall.index;
    }

    if (toolCall.id) {
        const existingIndex = toolCalls.findIndex(item => item?.id === toolCall.id);
        if (existingIndex !== -1) {
            return existingIndex;
        }
    }

    if (!toolCall.function?.name && toolCalls.length > 0) {
        return toolCalls.length - 1;
    }

    return toolCalls.length;
}

function stringifyToolArguments(args: unknown): string {
    return typeof args === 'string' ? args : JSON.stringify(args);
}
