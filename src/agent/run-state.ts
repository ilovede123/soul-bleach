/**
 * author:dengwei date:2026-07-18
 * 任务运行状态的创建、恢复和深拷贝。
 */
import { randomUUID } from 'crypto';
import { AgentRunState, TodoItem } from './types';

export function createRunState(task: string, plan: TodoItem[]): AgentRunState {
    const now = Date.now();
    return {
        runId: randomUUID(),
        task,
        status: 'running',
        startedAt: now,
        updatedAt: now,
        iteration: 0,
        plan: plan.map(item => ({ ...item })),
        fileTasks: [],
        changedFiles: [],
        validations: [],
        subagents: []
    };
}

export function restoreRunState(state: AgentRunState): AgentRunState {
    const restored = cloneRunState(state);
    if (restored.status === 'running') {
        restored.status = 'paused';
        restored.lastError = '扩展在任务执行期间关闭，任务已暂停，可以继续执行。';
    }
    return restored;
}

export function cloneRunState(state: AgentRunState): AgentRunState {
    return {
        ...state,
        plan: (state.plan ?? []).map(item => ({ ...item })),
        fileTasks: (state.fileTasks ?? []).map(item => ({ ...item })),
        changedFiles: [...(state.changedFiles ?? [])],
        validations: (state.validations ?? []).map(item => ({ ...item })),
        subagents: (state.subagents ?? []).map(item => ({ ...item }))
    };
}
