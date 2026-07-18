/**
 * 可测试的只读子智能体协调与执行核心。
 * 具体模型请求和工作区工具通过依赖注入提供，避免测试依赖 VS Code 运行时。
 */
import { randomUUID } from 'crypto';
import { createSubagentMessages } from './subagent-context';
import { parseToolArguments } from './tool-arguments';
import { SubagentActivity, SubagentRole } from './types';

export const DEFAULT_MAX_SUBAGENT_ITERATIONS = 24;
export const DEFAULT_MAX_SUBAGENT_CONCURRENCY = 2;
export const DEFAULT_MAX_SUBAGENT_ATTEMPTS = 2;
export const DEFAULT_MAX_CONSECUTIVE_TOOL_ERRORS = 3;

export type SubagentTask = { role: SubagentRole; task: string };

export type SubagentRuntimeDependencies = {
    complete: (messages: any[], tools: any[], signal?: AbortSignal) => Promise<any>;
    executeTool: (name: string | undefined, args: Record<string, any>) => Promise<string>;
    wait?: (milliseconds: number) => Promise<void>;
};

export type SubagentRuntimeOptions = {
    maxIterations?: number;
    maxConcurrency?: number;
    maxAttempts?: number;
    maxConsecutiveToolErrors?: number;
};

type SubagentResult = {
    role: SubagentRole;
    task: string;
    status: 'completed' | 'failed';
    attempts: number;
    summary?: string;
    error?: string;
};

export async function runSubagentsWithDependencies(
    parentTask: string,
    tasks: SubagentTask[],
    tools: any[],
    readOnlyTools: ReadonlySet<string>,
    dependencies: SubagentRuntimeDependencies,
    signal?: AbortSignal,
    onActivity?: (items: SubagentActivity[]) => void,
    options: SubagentRuntimeOptions = {}
): Promise<string> {
    validateTasks(tasks);
    const maxConcurrency = clampPositiveInteger(options.maxConcurrency, DEFAULT_MAX_SUBAGENT_CONCURRENCY);
    const maxAttempts = clampPositiveInteger(options.maxAttempts, DEFAULT_MAX_SUBAGENT_ATTEMPTS);
    const activities: SubagentActivity[] = tasks.map(task => ({
        id: randomUUID(), role: task.role, task: task.task, status: 'running'
    }));
    const results = new Array<SubagentResult>(tasks.length);
    publish();

    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(maxConcurrency, tasks.length) }, async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= tasks.length) {
                return;
            }
            results[index] = await runTask(tasks[index], index);
        }
    });
    await Promise.all(workers);

    return JSON.stringify({
        status: results.some(result => result.status === 'failed') ? 'partial' : 'completed',
        results
    }, null, 2);

    async function runTask(task: SubagentTask, index: number): Promise<SubagentResult> {
        let lastError = '';
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const summary = await runSingleSubagentWithDependencies(
                    parentTask,
                    task,
                    tools,
                    readOnlyTools,
                    dependencies,
                    signal,
                    options
                );
                const boundedSummary = summary.slice(0, 8000);
                activities[index].status = 'completed';
                activities[index].summary = boundedSummary;
                publish();
                return { role: task.role, task: task.task, status: 'completed', attempts: attempt, summary: boundedSummary };
            } catch (error: any) {
                if (error?.name === 'AbortError' || signal?.aborted) {
                    throw error;
                }
                lastError = error?.message ?? String(error);
                if (attempt < maxAttempts) {
                    activities[index].summary = `第 ${attempt} 次执行失败，正在重试：${lastError}`.slice(0, 8000);
                    publish();
                    await (dependencies.wait ?? defaultWait)(300 * attempt);
                }
            }
        }

        activities[index].status = 'failed';
        activities[index].summary = lastError.slice(0, 8000);
        publish();
        return { role: task.role, task: task.task, status: 'failed', attempts: maxAttempts, error: lastError.slice(0, 8000) };
    }

    function publish() {
        onActivity?.(activities.map(item => ({ ...item })));
    }
}

export async function runSingleSubagentWithDependencies(
    parentTask: string,
    task: SubagentTask,
    tools: any[],
    readOnlyTools: ReadonlySet<string>,
    dependencies: SubagentRuntimeDependencies,
    signal?: AbortSignal,
    options: SubagentRuntimeOptions = {}
): Promise<string> {
    const maxIterations = clampPositiveInteger(options.maxIterations, DEFAULT_MAX_SUBAGENT_ITERATIONS);
    const maxToolErrors = clampPositiveInteger(options.maxConsecutiveToolErrors, DEFAULT_MAX_CONSECUTIVE_TOOL_ERRORS);
    const messages = createSubagentMessages(parentTask, task);
    let consecutiveToolErrors = 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        throwIfAborted(signal);
        const message = await dependencies.complete(messages, tools, signal);
        messages.push(message);

        if (!message.tool_calls?.length) {
            if (!message.content) {
                throw new Error('子智能体没有返回内容。');
            }
            return String(message.content);
        }

        for (const toolCall of message.tool_calls) {
            const name = String(toolCall.function?.name ?? '');
            try {
                if (!readOnlyTools.has(name)) {
                    throw new Error(`不可用或非只读工具: ${name || 'unknown'}`);
                }
                const args = parseToolArguments(name, toolCall.function?.arguments || '{}');
                const result = await dependencies.executeTool(name, args);
                messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
                consecutiveToolErrors = 0;
            } catch (error: any) {
                consecutiveToolErrors++;
                const detail = error?.message ?? String(error);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: `[Soul Bleach Tool Error]\n工具 ${name || 'unknown'} 执行失败：${detail}\n请修正参数、改用其他只读工具，或基于已有证据完成摘要。`
                });
                if (consecutiveToolErrors >= maxToolErrors) {
                    throw new Error(`子智能体连续 ${consecutiveToolErrors} 次工具调用失败，最后错误：${detail}`);
                }
            }
        }

        if (iteration === maxIterations - 2) {
            messages.push({
                role: 'user',
                content: '你只剩最后一轮。请停止扩大调查范围，基于已有证据直接给出结构化结论、文件行号和未覆盖范围。'
            });
        }
    }

    throw new Error(`子智能体超过最大迭代次数 ${maxIterations}。`);
}

function validateTasks(tasks: SubagentTask[]) {
    if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 3) {
        throw new Error('delegate_tasks 每次必须包含 1-3 个子任务。');
    }
    const roles = new Set<SubagentRole>(['explorer', 'tester', 'reviewer']);
    for (const task of tasks) {
        if (!roles.has(task?.role) || !String(task?.task ?? '').trim()) {
            throw new Error('每个子任务都必须包含有效的 role 和非空 task。');
        }
    }
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) {
        return;
    }
    const error = new Error('Request aborted.');
    error.name = 'AbortError';
    throw error;
}

function defaultWait(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
