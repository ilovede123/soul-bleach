import { completion } from './request';
import { readFile, writeFile, listFiles } from './tool';

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: '读取工作区内的文件内容',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '相对于工作区根目录的文件路径' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: '写入文件内容',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '文件路径' },
                    content: { type: 'string', description: '要写入的内容' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: '列出目录下的文件',
            parameters: {
                type: 'object',
                properties: {
                    dir: { type: 'string', description: '目录路径，默认 "."' }
                },
                required: ['dir']
            }
        }
    }
];

function executeTool(name: string, args: Record<string, string>): string {
    if (name === 'read_file') {return readFile(args.path);}
    if (name === 'write_file') {return writeFile(args.path, args.content);}
    if (name === 'list_files') {return listFiles(args.dir);}
    return `未知工具: ${name}`;
}

export async function runAgent(task: string): Promise<string> {
    const messages: any[] = [
        {
            role: 'system',
            content: '你是一个代码助手，可以读写用户工作区的文件。先用 list_files 了解项目结构，再用 read_file 读取相关文件，最后用 write_file 完成修改。任务完成后回复总结。'
        },
        { role: 'user', content: task }
    ];

    const MAX_ITERATIONS = 20;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const message = await completion(messages, TOOLS);
        messages.push(message);

        if (!message.tool_calls || message.tool_calls.length === 0) {
            return message.content;
        }

        for (const toolCall of message.tool_calls) {
            const name = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);
            const result = executeTool(name, args);

            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result
            });
        }
    }

    throw new Error('超过最大迭代次数，任务终止');
}