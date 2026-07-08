import * as vscode from "vscode";

/**
 * author:dengwei date:2026-07-08
 * 模型请求配置统一入口。
 * provider 用来选择常见厂商的默认接口，baseUrl 和 model 保留手动覆盖能力，
 * 这样同一套 Agent 逻辑可以在千问、智谱和内网 OpenAI-compatible 服务之间切换。
 */
type ModelProvider = 'qwen' | 'zhipu-open' | 'zhipu-coding' | 'zai' | 'zhipu' | 'custom';
type ModelPreset = 'provider-default' | 'qwen3.7-plus' | 'qwen3.7-max' | 'qwen-plus' | 'glm-5.2' | 'glm-5.2-1m' | 'glm-5.1' | 'glm-5' | 'glm-4.7' | 'glm-4.7-flash' | 'custom';

type RequestPreset = {
    baseUrl: string;
    model: string;
    extraBody?: Record<string, unknown>;
};

const QWEN_EXTRA_BODY = {
    enable_thinking: false
};

const PROVIDER_PRESETS: Record<ModelProvider, RequestPreset> = {
    qwen: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        model: 'qwen3.7-plus',
        extraBody: QWEN_EXTRA_BODY
    },
    'zhipu-open': {
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        model: 'glm-5.2'
    },
    'zhipu-coding': {
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
        model: 'glm-4.7'
    },
    zai: {
        baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
        model: 'glm-5.2'
    },
    zhipu: {
        baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
        model: 'glm-5.2'
    },
    custom: {
        baseUrl: '',
        model: ''
    }
};

const MODEL_PRESETS: Record<Exclude<ModelPreset, 'provider-default'>, RequestPreset> = {
    'qwen3.7-plus': {
        baseUrl: PROVIDER_PRESETS.qwen.baseUrl,
        model: 'qwen3.7-plus',
        extraBody: QWEN_EXTRA_BODY
    },
    'qwen3.7-max': {
        baseUrl: PROVIDER_PRESETS.qwen.baseUrl,
        model: 'qwen3.7-max',
        extraBody: QWEN_EXTRA_BODY
    },
    'qwen-plus': {
        baseUrl: PROVIDER_PRESETS.qwen.baseUrl,
        model: 'qwen-plus',
        extraBody: QWEN_EXTRA_BODY
    },
    'glm-5.2': {
        baseUrl: PROVIDER_PRESETS['zhipu-open'].baseUrl,
        model: 'glm-5.2'
    },
    'glm-5.2-1m': {
        baseUrl: PROVIDER_PRESETS['zhipu-coding'].baseUrl,
        model: 'glm-5.2[1m]'
    },
    'glm-5.1': {
        baseUrl: PROVIDER_PRESETS['zhipu-open'].baseUrl,
        model: 'glm-5.1'
    },
    'glm-5': {
        baseUrl: PROVIDER_PRESETS['zhipu-open'].baseUrl,
        model: 'glm-5'
    },
    'glm-4.7': {
        baseUrl: PROVIDER_PRESETS['zhipu-coding'].baseUrl,
        model: 'glm-4.7'
    },
    'glm-4.7-flash': {
        baseUrl: PROVIDER_PRESETS['zhipu-coding'].baseUrl,
        model: 'glm-4.7-flash'
    },
    custom: {
        baseUrl: '',
        model: ''
    }
};

export function getConfig() {
    const config = vscode.workspace.getConfiguration('soul-bleach');
    const provider = config.get<ModelProvider>('provider', 'qwen');
    const modelPreset = config.get<ModelPreset>('modelPreset', 'provider-default');
    const providerPreset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.qwen;
    const selectedPreset = modelPreset === 'provider-default'
        ? providerPreset
        : MODEL_PRESETS[modelPreset] ?? providerPreset;
    const baseUrl = config.get<string>('baseUrl', '') || selectedPreset.baseUrl;
    const apiKey = config.get<string>('apiKey', '');
    const model = config.get<string>('model', '') || selectedPreset.model;
    return { provider, modelPreset, baseUrl, apiKey, model, extraBody: selectedPreset.extraBody ?? {} };
}

export async function completion(messages: any[], tools: any[], onChunk?: (text: string) => void, signal?: AbortSignal): Promise<any> {
    const { baseUrl, apiKey, model, extraBody } = getConfig();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };

    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    if (!baseUrl) {
        throw new Error('模型接口地址为空，请在设置中选择 provider 或填写 baseUrl。');
    }

    if (!model) {
        throw new Error('模型名称为空，请在设置中选择 provider 或填写 model。');
    }

    const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        ...extraBody
    };

    if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
    }

    const response = await fetch(baseUrl, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify(body)
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
    const debugLines: string[] = [];
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
            parseSseLine(line, fullMessage, thinkFilter.handleText, debugLines);
        }
    }

    buffer += decoder.decode();
    if (buffer) {
        parseSseLine(buffer, fullMessage, thinkFilter.handleText, debugLines);
    }
    thinkFilter.flush();

    if (!fullMessage.content) {
        delete fullMessage.content;
    } else {
        fullMessage.content = stripThinkBlocks(fullMessage.content);
    }

    if (!fullMessage.content && !fullMessage.tool_calls?.length && debugLines.length > 0) {
        fullMessage.debug = {
            samples: debugLines
        };
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
                        const emitLength = buffer.length - keepLength;
                        if (emitLength > 0) {
                            onChunk?.(`__SOUL_BLEACH_REASONING__${buffer.slice(0, emitLength)}`);
                            buffer = buffer.slice(emitLength);
                        }
                        return;
                    }

                    if (thinkEnd > 0) {
                        onChunk?.(`__SOUL_BLEACH_REASONING__${buffer.slice(0, thinkEnd)}`);
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

function parseSseLine(line: string, fullMessage: any, onChunk?: (text: string) => void, debugLines?: string[]) {
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
        collectDebugLine(debugLines, trimmedLine);
        return;
    }

    collectDebugLine(debugLines, trimmedLine, parsed);

    const choice = findFirstChoice(parsed);
    const delta = choice?.delta ?? choice?.message ?? parsed.message ?? parsed;
    const content = normalizeContent(delta?.content ?? delta?.text ?? choice?.text ?? parsed.response);

    if (content) {
        fullMessage.content += content;
        onChunk?.(content);
    }

    if (delta?.reasoning_content) {
        onChunk?.('__SOUL_BLEACH_THINKING__');
        onChunk?.(`__SOUL_BLEACH_REASONING__${normalizeContent(delta.reasoning_content)}`);
    }

    if (delta?.function_call) {
        fullMessage.tool_calls ??= [];
        fullMessage.tool_calls[0] ??= {
            id: 'legacy_function_call',
            type: 'function',
            function: { name: delta.function_call.name, arguments: '' }
        };

        if (delta.function_call.name) {
            fullMessage.tool_calls[0].function.name = delta.function_call.name;
        }

        if (delta.function_call.arguments !== undefined) {
            fullMessage.tool_calls[0].function.arguments += stringifyToolArguments(delta.function_call.arguments);
        }
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

function collectDebugLine(debugLines: string[] | undefined, line: string, parsed?: any) {
    if (!debugLines) {
        return;
    }

    const choice = findFirstChoice(parsed);
    const delta = choice?.delta ?? choice?.message ?? parsed?.message ?? parsed;
    const isUseful = !parsed
        || normalizeContent(delta?.content ?? delta?.text ?? choice?.text ?? parsed?.response).length > 0
        || Boolean(delta?.tool_calls)
        || Boolean(delta?.function_call)
        || Boolean(choice?.finish_reason);

    if (!isUseful && debugLines.length > 0) {
        return;
    }

    if (debugLines.length >= 8) {
        return;
    }

    debugLines.push(line.slice(0, 800));
}

function normalizeContent(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map(item => {
                if (typeof item === 'string') {
                    return item;
                }

                return item?.text ?? item?.content ?? '';
            })
            .join('');
    }

    return '';
}

function findFirstChoice(value: any): any {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    if (Array.isArray(value.choices) && value.choices.length > 0) {
        return value.choices[0];
    }

    for (const item of Object.values(value)) {
        const choice = findFirstChoice(item);
        if (choice) {
            return choice;
        }
    }

    return undefined;
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
