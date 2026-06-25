import { completion } from './request';
import { readFile, writeFile, listFiles, findFiles, readFileWithLineNumbers, replaceRange } from './tool';

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

export async function runAgent(task: string, onChunk?: (text: string) => void, signal?: AbortSignal): Promise<string> {
    const messages: any[] = [
        {
            role: 'system',
            content: [
                '你是一个 VS Code 代码智能体，可以帮助用户理解、查看和修改当前工作区中的文件。',
                '在处理代码任务前，先使用 list_files 了解项目结构。',
                '当用户只提供文件名或路径不完整时，先使用 find_files 查找准确路径，再读取或修改文件。',
                '当需要查看文件内容时，可以使用 read_file。',
                '当需要修改代码时，优先使用 read_file_with_line_numbers 查看带行号的文件内容，以便定位要修改的具体行。',
                '当需要修改已有文件时，优先使用 replace_range 进行小范围替换，不要随意使用 write_file 覆盖整个文件。',
                '使用 replace_range 前，必须先确认 startLine 和 endLine。',
                '只有在确实需要创建新文件或完整重写文件时，才使用 write_file。',
                '任务完成后，用简洁的中文向用户总结你做了什么。'
            ].join(' ')
        },
        { role: 'user', content: task }
    ];

    const maxIterations = 20;

    for (let i = 0; i < maxIterations; i++) {
        throwIfAborted(signal);

        const message = await completion(messages, TOOLS, onChunk, signal);
        messages.push(message);

        if (!message.tool_calls || message.tool_calls.length === 0) {
            return message.content ?? '';
        }

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
