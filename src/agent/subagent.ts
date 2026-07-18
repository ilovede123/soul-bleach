/**
 * author:dengwei date:2026-07-18
 * 只读子智能体运行器。每个子智能体拥有独立上下文，只通过最终摘要与主智能体通信。
 */
import { completion } from '../request';
import * as vscode from 'vscode';
import { AGENT_TOOLS, executeAgentTool } from './tools';
import { SubagentActivity } from './types';
import { runSubagentsWithDependencies, SubagentTask } from './subagent-runtime';

const READ_ONLY_TOOLS = new Set([
    'get_project_map', 'find_symbol', 'get_diagnostics', 'read_file',
    'read_file_with_line_numbers', 'list_files', 'find_files', 'search_text',
    'git_status', 'git_diff', 'run_command'
]);

export { SubagentTask } from './subagent-runtime';

export async function runSubagents(
    parentTask: string,
    tasks: SubagentTask[],
    signal?: AbortSignal,
    onActivity?: (items: SubagentActivity[]) => void
): Promise<string> {
    const tools = AGENT_TOOLS.filter(tool => READ_ONLY_TOOLS.has(tool.function.name));
    const maxConcurrency = vscode.workspace.getConfiguration('soul-bleach').get<number>('subagentConcurrency', 2);
    return runSubagentsWithDependencies(parentTask, tasks, tools, READ_ONLY_TOOLS, {
        complete: (messages, definitions, currentSignal) => completion(messages, definitions, undefined, currentSignal),
        executeTool: executeAgentTool
    }, signal, onActivity, { maxConcurrency });
}
