import { completion } from './request';
import { findFiles, listFiles, readFileWithLineNumbers } from './tool';
import { compactMessages } from './agent/context';
import { createPlan, completeAllTodos, setActiveTodo, setActiveTodoByTool, setFinalTodo, shouldCreatePlan } from './agent/planner';
import { createInitialMessages } from './agent/prompts';
import { AGENT_TOOLS, executeAgentTool } from './agent/tools';
import { ProgressHandler, TodoItem } from './agent/types';

export { TodoItem } from './agent/types';

/**
 * author:dengwei date:2026-07-08
 * Agent 主流程入口。
 * 这里保留会话状态、模型循环和工具调用调度，
 * 具体工具声明、提示词、任务规划和上下文压缩已经拆到独立模块。
 */
const LOCAL_FILE_RESULT_MARKER = '[Soul Bleach Local File Result]';
const MAX_REPEATED_TOOL_ERRORS = 3;

export class AgentSession {
    private messages: any[] = createInitialMessages();

    clear() {
        this.messages = createInitialMessages();
    }

    async run(task: string, onChunk?: (text: string) => void, signal?: AbortSignal, onProgress?: ProgressHandler): Promise<string> {
        const todos = await createTodosIfNeeded(task, signal, onProgress);
        this.messages.push({ role: 'user', content: task });
        const result = await runAgentLoop(this.messages, onChunk, signal, todos, onProgress);
        completeAllTodos(todos, onProgress);
        this.trimMessages();
        return result;
    }

    private trimMessages() {
        this.messages = compactMessages(this.messages);
    }
}

export async function runAgent(task: string, onChunk?: (text: string) => void, signal?: AbortSignal, onProgress?: ProgressHandler): Promise<string> {
    const messages: any[] = createInitialMessages();
    const todos = await createTodosIfNeeded(task, signal, onProgress);
    messages.push({ role: 'user', content: task });
    const result = await runAgentLoop(messages, onChunk, signal, todos, onProgress);
    completeAllTodos(todos, onProgress);
    return result;
}

async function createTodosIfNeeded(task: string, signal?: AbortSignal, onProgress?: ProgressHandler): Promise<TodoItem[] | undefined> {
    if (!shouldCreatePlan(task)) {
        onProgress?.([]);
        return undefined;
    }

    const todos = await createPlan(task, signal);
    setActiveTodo(todos, onProgress, 0);
    return todos;
}

async function runAgentLoop(messages: any[], onChunk?: (text: string) => void, signal?: AbortSignal, todos?: TodoItem[], onProgress?: ProgressHandler): Promise<string> {
    const maxIterations = 20;
    let lastToolError = '';
    let repeatedToolErrors = 0;

    for (let i = 0; i < maxIterations; i++) {
        throwIfAborted(signal);

        const message = await completion(messages, AGENT_TOOLS, onChunk, signal);
        messages.push(message);

        if (!message.tool_calls || message.tool_calls.length === 0) {
            if (shouldUseLocalFileFallback(messages, message)) {
                const result = executeLocalFileFallback(messages);
                messages.push({
                    role: 'user',
                    content: `${LOCAL_FILE_RESULT_MARKER}\n${result}\n\n请基于上面的本地文件结果继续回答用户。`
                });
                continue;
            }

            if (!message.content) {
                throw new Error(createEmptyResponseError(message));
            }

            if (shouldContinueForToolUse(messages, message.content)) {
                messages.push({
                    role: 'user',
                    content: '请不要只说明将要查看文件。请直接调用可用工具查找或读取相关文件，然后基于工具结果回答。'
                });
                continue;
            }

            setFinalTodo(todos, onProgress);
            return message.content ?? '';
        }

        for (const toolCall of message.tool_calls) {
            throwIfAborted(signal);

            const name = toolCall.function?.name;
            const rawArgs = toolCall.function?.arguments || '{}';
            let result: string;

            try {
                setActiveTodoByTool(todos, onProgress, name);
                const args = parseToolArguments(name, rawArgs);
                if (toolCall.function) {

                    toolCall.function.arguments = JSON.stringify(args);
                }
                result = executeAgentTool(name, args);
                lastToolError = '';
                repeatedToolErrors = 0;
            } catch (e: any) {
                result = formatToolError(name, e);
                const errorKey = getToolErrorKey(name, e);
                repeatedToolErrors = errorKey === lastToolError ? repeatedToolErrors + 1 : 1;
                lastToolError = errorKey;
            }

            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result
            });

            if (repeatedToolErrors >= MAX_REPEATED_TOOL_ERRORS) {
                setFinalTodo(todos, onProgress);
                return [
                    '任务已停止：同一个工具错误连续出现，继续重试会导致循环。',
                    '',
                    result,
                    '',
                    '建议：重新读取目标文件的最新行号和原始内容后，再重新发起修改。'
                ].join('\n');
            }
        }
    }

    setFinalTodo(todos, onProgress);
    return [
        '任务已停止：执行轮次达到上限，未能稳定完成。',
        '通常原因是模型反复调用工具但没有根据工具结果修正参数。',
        '建议缩小需求范围，或先让智能体重新读取目标文件后再修改。'
    ].join('\n');
}

function formatToolError(name: string | undefined, error: any): string {
    return [
        `工具执行失败: ${name ?? 'unknown'}`,
        error?.message ?? String(error),
        '请根据错误信息调整参数。如果是 replace_range 内容不一致，必须重新读取带行号的文件内容后再重试。'
    ].join('\n');
}

function getToolErrorKey(name: string | undefined, error: any): string {
    return `${name ?? 'unknown'}:${error?.message ?? String(error)}`;
}

function shouldContinueForToolUse(messages: any[], content: string): boolean {
    const latestUserMessage = getLatestUserTask(messages);
    const asksForFileWork = /查看|读取|查找|分析|修改|打开|文件|代码|read|find|file|code/i.test(String(latestUserMessage));
    const onlyAnnouncesIntent = /我来|我将|我会|让我|帮你|查找并查看|查看.*文件|查找.*文件/.test(content);
    const alreadyRetried = messages.some(message => message.role === 'user' && String(message.content).includes('请不要只说明将要查看文件'));

    return asksForFileWork && onlyAnnouncesIntent && !alreadyRetried;
}

function shouldUseLocalFileFallback(messages: any[], message: any): boolean {
    const latestUserMessage = getLatestUserTask(messages);
    const asksForFileWork = /查看|读取|查找|分析|打开|文件|代码|read|find|file|code/i.test(latestUserMessage);
    const requestedToolCallWithoutPayload = message.finish_reason === 'tool_calls' && !message.tool_calls?.length;
    const passiveLookupReply = message.content && shouldContinueForToolUse(messages, message.content);
    const alreadyUsedFallback = messages.some(item => item.role === 'user' && String(item.content).startsWith(LOCAL_FILE_RESULT_MARKER));

    return asksForFileWork && !alreadyUsedFallback && (requestedToolCallWithoutPayload || passiveLookupReply);
}

function executeLocalFileFallback(messages: any[]): string {
    const task = getLatestUserTask(messages);
    const query = extractFileQuery(task);

    if (!query) {
        return [
            '用户要求查看代码，但没有提供明确文件名。',
            '当前工作区根目录文件如下：',
            listFiles('.')
        ].join('\n');
    }

    try {
        return [
            `已读取文件: ${query}`,
            readFileWithLineNumbers(query)
        ].join('\n');
    } catch {
        const found = findFiles(query, 10);
        const firstPath = getFirstFilePath(found);

        if (!firstPath) {
            return [
                `没有直接读取到文件: ${query}`,
                '搜索结果:',
                found
            ].join('\n');
        }

        return [
            `根据 "${query}" 找到并读取文件: ${firstPath}`,
            readFileWithLineNumbers(firstPath)
        ].join('\n');
    }
}

function getLatestUserTask(messages: any[]): string {
    const message = [...messages].reverse().find(item => {
        const content = String(item.content ?? '');
        return item.role === 'user'
            && !content.includes('请不要只说明将要查看文件')
            && !content.startsWith(LOCAL_FILE_RESULT_MARKER);
    });

    return String(message?.content ?? '');
}

function extractFileQuery(text: string): string {
    const quoted = text.match(/["'`“”‘’]([^"'`“”‘’]+\.[\w-]+)["'`“”‘’]/)?.[1];
    if (quoted) {
        return quoted.trim();
    }

    const fileLike = text.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|html|css|scss|less|py|java|go|rs|vue|svelte|yml|yaml|toml|xml|txt|env)/i)?.[0];
    if (fileLike) {
        return fileLike.trim();
    }

    const namedFile = text.match(/(?:文件|代码)\s*[:：]?\s*([\w./\\-]+)/)?.[1];
    return namedFile?.trim() ?? '';
}

function getFirstFilePath(searchResult: string): string | undefined {
    return searchResult
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('[DIR]') && !line.startsWith('没有找到'))[0];
}

function createEmptyResponseError(message: any): string {
    const samples = message.debug?.samples;

    if (!samples?.length) {
        return '模型没有返回可显示内容，也没有返回工具调用。请检查内网模型是否使用 OpenAI-compatible 流式格式，例如 data: {...}、choices[0].delta.content 或 choices[0].delta.tool_calls。';
    }

    return [
        '模型响应已收到，但没有解析出 content 或 tool_calls。',
        '下面是内网服务返回的原始片段，请按这个结构适配解析器：',
        ...samples.map((line: string, index: number) => `${index + 1}. ${line}`)
    ].join('\n');
}

function throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) {
        return;
    }

    const error = new Error('Request aborted.');
    error.name = 'AbortError';
    throw error;
}

function parseToolArguments(name: string | undefined, rawArgs: string): Record<string, string> {
    try {
        return JSON.parse(rawArgs);
    } catch (e: any) {
        const repairedArgs = repairToolArguments(name, rawArgs);
        if (repairedArgs) {
            return repairedArgs;
        }

        console.error('Failed to parse tool arguments:', {
            tool: name,
            rawArgs,
            error: e
        });

        throw new Error([
            '工具参数不是合法 JSON。',
            `工具: ${name ?? 'unknown'}`,
            `参数: ${rawArgs}`,
            `错误: ${e?.message ?? String(e)}`
        ].join('\n'));
    }
}

function repairToolArguments(name: string | undefined, rawArgs: string): Record<string, string> | undefined {
    if (name === 'list_files') {
        return { dir: extractStringArgument(rawArgs, 'dir') || '.' };
    }

    if (name === 'find_files') {
        const query = extractStringArgument(rawArgs, 'query');
        return query ? { query } : undefined;
    }

    if (name === 'search_text') {
        const query = extractStringArgument(rawArgs, 'query');
        const path = extractStringArgument(rawArgs, 'path');
        return query ? { query, ...(path ? { path } : {}) } : undefined;
    }

    if (name === 'run_command') {
        const command = extractStringArgument(rawArgs, 'command');
        return command ? { command } : undefined;
    }

    if (name === 'read_file' || name === 'read_file_with_line_numbers') {
        const path = extractStringArgument(rawArgs, 'path');
        return path ? { path } : undefined;
    }

    return undefined;
}

function extractStringArgument(rawArgs: string, key: string): string | undefined {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"}]*)`);
    return rawArgs.match(pattern)?.[1];
}
