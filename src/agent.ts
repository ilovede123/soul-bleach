import { completion } from './request';
import { readFile, writeFile, listFiles, findFiles, readFileWithLineNumbers, replaceRange } from './tool';

type TodoStatus = 'pending' | 'in_progress' | 'completed';

export type TodoItem = {
    id: string;
    title: string;
    status: TodoStatus;
};

type ProgressHandler = (items: TodoItem[]) => void;

const CONTEXT_SUMMARY_MARKER = '[Soul Bleach Context Summary]';
const MAX_CONTEXT_MESSAGES = 42;
const RECENT_CONTEXT_MESSAGES = 24;
const MAX_SUMMARY_LENGTH = 6000;
const MAX_MESSAGE_SNIPPET_LENGTH = 700;
const LOCAL_FILE_RESULT_MARKER = '[Soul Bleach Local File Result]';

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read a file inside the current VS Code workspace.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path relative to the workspace root.'
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write content to a file inside the current VS Code workspace.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path relative to the workspace root.'
                    },
                    content: {
                        type: 'string',
                        description: 'Content to write.'
                    }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List files in a directory inside the current VS Code workspace.',
            parameters: {
                type: 'object',
                properties: {
                    dir: {
                        type: 'string',
                        description: 'Optional directory path relative to the workspace root. Use "." for the root.'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'find_files',
            description: '根据文件名或路径片段在当前工作区中搜索文件路径。当用户只提供文件名、不知道完整路径时使用。',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: '要搜索的文件名或路径片段，例如 "agent.ts"、"request"、"README"'
                    },
                    maxResults: {
                        type: 'number',
                        description: '最多返回多少条结果，默认 30'
                    }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file_with_line_numbers',
            description: '读取文件，返回带有行号的内容',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '当前工作区内的文件路径'
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'replace_range',
            description: '替换当前工作区文件中指定行号范围的内容',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '当前工作区内的文件路径'
                    },
                    startLine: {
                        type: 'number',
                        description: '开始行号，从 1 开始'
                    },
                    endLine: {
                        type: 'number',
                        description: '结束行号，包含这一行'
                    },
                    newContent: {
                        type: 'string',
                        description: '用于替换指定行范围的新内容'
                    }
                },
                required: ['path', 'startLine', 'endLine', 'newContent']
            }
        }
    }
];

function executeTool(name: string, args: Record<string, string>): string {
    if (name === 'read_file') {
        return readFile(args.path);
    }
    if (name === 'read_file_with_line_numbers') {
        return readFileWithLineNumbers(args.path);
    }

    if (name === 'write_file') {
        return writeFile(args.path, args.content);
    }

    if (name === 'list_files') {
        return listFiles(args.dir || '.');
    }

    if (name === 'find_files') {
        return findFiles(args.query, Number(args.maxResults) || 30);
    }

    if (name === 'replace_range') {
        return replaceRange(args.path, Number(args.startLine), Number(args.endLine), args.newContent);
    }

    return `Unknown tool: ${name}`;
}

function createInitialMessages(): any[] {
    return [
        {
            role: 'system',
            content: [
                '你是一个 VS Code 代码智能体，可以帮助用户理解、查看和修改当前工作区中的文件。',
                '在处理代码任务前，先使用 list_files 了解项目结构。',
                '当用户只提供文件名或路径不完整时，先使用 find_files 查找准确路径，再读取或修改文件。',
                '当需要查看文件内容时，可以使用 read_file。',
                '如果用户要求查看、读取、分析或修改文件，必须直接调用工具获取文件内容，不要只回复“我来查看”或“我来查找”。',
                '当需要修改代码时，优先使用 read_file_with_line_numbers 查看带行号的文件内容，以便定位要修改的具体行。',
                '当需要修改已有文件时，优先使用 replace_range 进行小范围替换，不要随意使用 write_file 覆盖整个文件。',
                '使用 replace_range 前，必须先确认 startLine 和 endLine。',
                '只有在确实需要创建新文件或完整重写文件时，才使用 write_file。',
                '任务完成后，用简洁的中文向用户总结你做了什么。'
            ].join(' ')
        }
    ];
}

export class AgentSession {
    private messages: any[] = createInitialMessages();

    clear() {
        this.messages = createInitialMessages();
    }

    async run(task: string, onChunk?: (text: string) => void, signal?: AbortSignal, onProgress?: ProgressHandler): Promise<string> {
        const todos = createTodos(task);
        updateTodos(todos, onProgress, 'understand', 'in_progress');
        this.messages.push({ role: 'user', content: task });
        const result = await runAgentLoop(this.messages, onChunk, signal, todos, onProgress);
        updateTodos(todos, onProgress, 'summary', 'completed');
        this.trimMessages();
        return result;
    }

    private trimMessages() {
        this.messages = compactMessages(this.messages);
    }
}

export async function runAgent(task: string, onChunk?: (text: string) => void, signal?: AbortSignal, onProgress?: ProgressHandler): Promise<string> {
    const messages: any[] = createInitialMessages();
    const todos = createTodos(task);
    updateTodos(todos, onProgress, 'understand', 'in_progress');
    messages.push({ role: 'user', content: task });
    const result = await runAgentLoop(messages, onChunk, signal, todos, onProgress);
    updateTodos(todos, onProgress, 'summary', 'completed');
    return result;
}

async function runAgentLoop(messages: any[], onChunk?: (text: string) => void, signal?: AbortSignal, todos?: TodoItem[], onProgress?: ProgressHandler): Promise<string> {
    const maxIterations = 20;

    for (let i = 0; i < maxIterations; i++) {
        throwIfAborted(signal);

        updateTodos(todos, onProgress, 'understand', 'completed');
        updateTodos(todos, onProgress, 'context', 'in_progress');
        const message = await completion(messages, TOOLS, onChunk, signal);
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

            updateTodos(todos, onProgress, 'context', 'completed');
            updateTodos(todos, onProgress, 'work', 'completed');
            updateTodos(todos, onProgress, 'summary', 'in_progress');
            return message.content ?? '';
        }

        updateTodos(todos, onProgress, 'context', 'completed');
        updateTodos(todos, onProgress, 'work', 'in_progress');

        for (const toolCall of message.tool_calls) {
            throwIfAborted(signal);

            const name = toolCall.function?.name;
            const rawArgs = toolCall.function?.arguments || '{}';

            const args = parseToolArguments(name, rawArgs);
            if (toolCall.function) {

                toolCall.function.arguments = JSON.stringify(args);
            }
            const result = executeTool(name, args);

            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result
            });
        }
    }

    throw new Error('Agent stopped because it exceeded the maximum iteration count.');
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

function createTodos(task: string): TodoItem[] {
    const isEditTask = /修改|写入|替换|加上|删除|优化|重构|实现|修复|edit|write|fix|update/i.test(task);

    return [
        { id: 'understand', title: '理解需求并拆解任务', status: 'pending' },
        { id: 'context', title: '定位相关文件和上下文', status: 'pending' },
        { id: 'work', title: isEditTask ? '执行代码修改' : '读取信息并整理结论', status: 'pending' },
        { id: 'summary', title: '总结结果并给出下一步', status: 'pending' }
    ];
}

function updateTodos(todos: TodoItem[] | undefined, onProgress: ProgressHandler | undefined, id: string, status: TodoStatus) {
    if (!todos || !onProgress) {
        return;
    }

    const index = todos.findIndex(item => item.id === id);
    if (index === -1) {
        return;
    }

    todos[index] = { ...todos[index], status };
    onProgress(todos.map(item => ({ ...item })));
}

function compactMessages(messages: any[]): any[] {
    if (messages.length <= MAX_CONTEXT_MESSAGES) {
        return messages;
    }

    const systemMessage = messages[0];
    const recentStart = findRecentStart(messages);
    const previousSummary = extractExistingSummary(messages);
    const oldMessages = messages
        .slice(1, recentStart)
        .filter(message => !isContextSummary(message));
    const summary = buildContextSummary(previousSummary, oldMessages);
    const recentMessages = messages.slice(recentStart);

    return [
        systemMessage,
        {
            role: 'system',
            content: `${CONTEXT_SUMMARY_MARKER}\n${summary}`
        },
        ...recentMessages
    ];
}

function findRecentStart(messages: any[]): number {
    let start = Math.max(1, messages.length - RECENT_CONTEXT_MESSAGES);

    while (start < messages.length && messages[start]?.role === 'tool') {
        start++;
    }

    return start;
}

function extractExistingSummary(messages: any[]): string {
    const summaryMessage = messages.find(isContextSummary);
    if (!summaryMessage?.content) {
        return '';
    }

    return String(summaryMessage.content).replace(CONTEXT_SUMMARY_MARKER, '').trim();
}

function isContextSummary(message: any): boolean {
    return message?.role === 'system' && typeof message.content === 'string' && message.content.startsWith(CONTEXT_SUMMARY_MARKER);
}

function buildContextSummary(previousSummary: string, messages: any[]): string {
    const parts: string[] = [];

    if (previousSummary) {
        parts.push(previousSummary);
    }

    for (const message of messages) {
        const summaryLine = summarizeMessage(message);
        if (summaryLine) {
            parts.push(summaryLine);
        }
    }

    return truncateText(parts.join('\n'), MAX_SUMMARY_LENGTH);
}

function summarizeMessage(message: any): string {
    if (message.role === 'user') {
        return `用户需求: ${truncateText(message.content, MAX_MESSAGE_SNIPPET_LENGTH)}`;
    }

    if (message.role === 'assistant') {
        const lines: string[] = [];

        if (message.content) {
            lines.push(`助手回复: ${truncateText(message.content, MAX_MESSAGE_SNIPPET_LENGTH)}`);
        }

        if (message.tool_calls?.length) {
            for (const toolCall of message.tool_calls) {
                const name = toolCall.function?.name ?? 'unknown';
                const args = truncateText(toolCall.function?.arguments ?? '', 400);
                lines.push(`工具调用: ${name}(${args})`);
            }
        }

        return lines.join('\n');
    }

    if (message.role === 'tool') {
        return `工具结果: ${truncateText(message.content, MAX_MESSAGE_SNIPPET_LENGTH)}`;
    }

    return '';
}

function truncateText(value: unknown, maxLength: number): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();

    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, maxLength)}...`;
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

    if (name === 'read_file') {
        const path = extractStringArgument(rawArgs, 'path');
        return path ? { path } : undefined;
    }

    return undefined;
}

function extractStringArgument(rawArgs: string, key: string): string | undefined {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"}]*)`);
    return rawArgs.match(pattern)?.[1];
}
