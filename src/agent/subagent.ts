/**
 * author:dengwei date:2026-07-18
 * 只读子智能体运行器。每个子智能体拥有独立上下文，只通过最终摘要与主智能体通信。
 */
import { randomUUID } from 'crypto';
import { completion } from '../request';
import { AGENT_TOOLS, executeAgentTool } from './tools';
import { SubagentActivity, SubagentRole } from './types';
import { createSubagentMessages } from './subagent-context';

const MAX_SUBAGENT_ITERATIONS = 12;
const READ_ONLY_TOOLS = new Set([
    'get_project_map', 'find_symbol', 'get_diagnostics', 'read_file',
    'read_file_with_line_numbers', 'list_files', 'find_files', 'search_text',
    'git_status', 'git_diff', 'run_command'
]);

export type SubagentTask = { role: SubagentRole; task: string };

export async function runSubagents(
    parentTask: string,
    tasks: SubagentTask[],
    signal?: AbortSignal,
    onActivity?: (items: SubagentActivity[]) => void
): Promise<string> {
    if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 3) {
        throw new Error('delegate_tasks 每次必须包含 1-3 个子任务。');
    }
    const activities: SubagentActivity[] = tasks.map(task => ({
        id: randomUUID(), role: task.role, task: task.task, status: 'running'
    }));
    publish();

    const results = await Promise.all(tasks.map(async (task, index) => {
        try {
            const summary = await runSingleSubagent(parentTask, task, signal);
            activities[index].status = 'completed';
            activities[index].summary = summary.slice(0, 8000);
            publish();
            return `[${task.role}]\n${summary}`;
        } catch (error: any) {
            activities[index].status = 'failed';
            activities[index].summary = error?.message ?? String(error);
            publish();
            return `[${task.role} 失败]\n${activities[index].summary}`;
        }
    }));
    return results.join('\n\n');

    function publish() {
        onActivity?.(activities.map(item => ({ ...item })));
    }
}

async function runSingleSubagent(parentTask: string, task: SubagentTask, signal?: AbortSignal): Promise<string> {
    const messages = createSubagentMessages(parentTask, task);
    const tools = AGENT_TOOLS.filter(tool => READ_ONLY_TOOLS.has(tool.function.name));

    for (let iteration = 0; iteration < MAX_SUBAGENT_ITERATIONS; iteration++) {
        if (signal?.aborted) {
            const error = new Error('Request aborted.');
            error.name = 'AbortError';
            throw error;
        }
        const message = await completion(messages, tools, undefined, signal);
        messages.push(message);
        if (!message.tool_calls?.length) {
            if (!message.content) {
                throw new Error('子智能体没有返回内容。');
            }
            return String(message.content);
        }
        for (const toolCall of message.tool_calls) {
            const name = toolCall.function?.name;
            if (!READ_ONLY_TOOLS.has(String(name))) {
                throw new Error(`子智能体试图调用非只读工具: ${name}`);
            }
            const args = JSON.parse(toolCall.function?.arguments || '{}');
            const result = await executeAgentTool(name, args);
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
        }
    }
    throw new Error(`子智能体超过最大迭代次数 ${MAX_SUBAGENT_ITERATIONS}。`);
}
