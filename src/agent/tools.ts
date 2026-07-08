/**
 * author:dengwei date:2026-07-08
 * Agent 可调用工具的声明和执行入口。
 * 这里负责把模型看到的工具协议映射到本地文件能力，避免主循环里混入大量工具细节。
 */
import { findFiles, listFiles, readFile, readFileWithLineNumbers, replaceRange, searchText, writeFile } from '../tool';

export const AGENT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: '读取当前工作区内的小文件全文。代码文件或大文件优先使用 read_file_with_line_numbers 按范围读取，避免一次性占用过多上下文。',
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
            name: 'search_text',
            description: '按关键字搜索当前工作区或指定文件内容，返回命中的文件、行号和附近少量上下文。用于先定位关键代码，再用 read_file_with_line_numbers 读取片段。',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: '要搜索的代码关键字、函数名、变量名或文本'
                    },
                    path: {
                        type: 'string',
                        description: '可选，限制只在某个工作区文件内搜索'
                    },
                    maxResults: {
                        type: 'number',
                        description: '可选，最多返回多少条命中，默认 30'
                    },
                    contextLines: {
                        type: 'number',
                        description: '可选，每条命中前后返回多少行上下文，默认 2，最大 5'
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
            description: '按行号范围读取文件内容，返回带行号的片段。默认只返回一小段，避免把大文件一次性全部放入上下文。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '当前工作区内的文件路径'
                    },
                    startLine: {
                        type: 'number',
                        description: '可选，开始行号，从 1 开始。未传时默认从第 1 行开始'
                    },
                    endLine: {
                        type: 'number',
                        description: '可选，结束行号，包含这一行。未传时按 maxLines 截断'
                    },
                    maxLines: {
                        type: 'number',
                        description: '可选，最多返回多少行，默认 200。只在确实需要更多上下文时调大'
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
                    oldContent: {
                        type: 'string',
                        description: '当前文件中 startLine 到 endLine 的原始内容，必须和最新读取到的内容完全一致'
                    },
                    newContent: {
                        type: 'string',
                        description: '用于替换指定行范围的新内容'
                    }
                },
                required: ['path', 'startLine', 'endLine', 'oldContent', 'newContent']
            }
        }
    }
];

export function executeAgentTool(name: string | undefined, args: Record<string, string>): string {
    if (name === 'read_file') {
        return readFile(args.path);
    }

    if (name === 'read_file_with_line_numbers') {
        return readFileWithLineNumbers(args.path, Number(args.startLine) || 1, args.endLine === undefined ? undefined : Number(args.endLine), Number(args.maxLines) || undefined);
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

    if (name === 'search_text') {
        return searchText(args.query, args.path, Number(args.maxResults) || undefined, Number(args.contextLines) || undefined);
    }

    if (name === 'replace_range') {
        return replaceRange(args.path, Number(args.startLine), Number(args.endLine), args.oldContent, args.newContent);
    }

    return `Unknown tool: ${name ?? 'unknown'}`;
}
