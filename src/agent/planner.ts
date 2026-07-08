/**
 * author:dengwei date:2026-07-08
 * 任务规划和进度状态管理。
 * createPlan 负责把用户需求拆成 todo，setActiveTodo/completeAllTodos 负责同步面板进度。
 */
import { completion } from '../request';
import { PLANNER_SYSTEM_PROMPT } from './prompts';
import { ProgressHandler, TodoItem, TodoStatus } from './types';

export async function createPlan(task: string, signal?: AbortSignal): Promise<TodoItem[]> {
    try {
        const message = await completion([
            {
                role: 'system',
                content: PLANNER_SYSTEM_PROMPT
            },
            { role: 'user', content: task }
        ], [], undefined, signal);

        return parsePlan(message.content);
    } catch {
        return createFallbackTodos(task);
    }
}

export function setActiveTodo(todos: TodoItem[] | undefined, onProgress: ProgressHandler | undefined, activeIndex: number) {
    if (!todos || !onProgress) {
        return;
    }

    if (todos.length === 0) {
        return;
    }

    const safeIndex = Math.max(0, Math.min(activeIndex, todos.length - 1));

    for (let index = 0; index < todos.length; index++) {
        if (index < safeIndex) {
            todos[index] = { ...todos[index], status: 'completed' };
        } else if (index === safeIndex) {
            todos[index] = { ...todos[index], status: 'in_progress' };
        } else {
            todos[index] = { ...todos[index], status: 'pending' };
        }
    }

    publishTodos(todos, onProgress);
}

export function completeAllTodos(todos: TodoItem[] | undefined, onProgress: ProgressHandler | undefined) {
    if (!todos || !onProgress) {
        return;
    }

    for (let index = 0; index < todos.length; index++) {
        todos[index] = { ...todos[index], status: 'completed' };
    }

    publishTodos(todos, onProgress);
}

function parsePlan(content: string | undefined): TodoItem[] {
    if (!content) {
        throw new Error('Planner returned empty content.');
    }

    const jsonText = extractJsonObject(content);
    const parsed = JSON.parse(jsonText);
    const items = Array.isArray(parsed.todos) ? parsed.todos : [];
    const todos = items
        .map((item: any, index: number) => ({
            id: `plan-${index + 1}`,
            title: String(item.title ?? '').trim(),
            status: 'pending' as TodoStatus
        }))
        .filter((item: TodoItem) => item.title.length > 0)
        .slice(0, 6);

    if (todos.length === 0) {
        throw new Error('Planner returned no todo items.');
    }

    return todos;
}

function extractJsonObject(content: string): string {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
        throw new Error('Planner response did not contain JSON.');
    }

    return match[0];
}

function createFallbackTodos(task: string): TodoItem[] {
    const isEditTask = /修改|写入|替换|加上|删除|优化|重构|实现|修复|edit|write|fix|update/i.test(task);

    return [
        { id: 'understand', title: '理解需求并拆解任务', status: 'pending' },
        { id: 'context', title: '定位相关文件和上下文', status: 'pending' },
        { id: 'work', title: isEditTask ? '执行代码修改' : '读取信息并整理结论', status: 'pending' },
        { id: 'summary', title: '总结结果并给出下一步', status: 'pending' }
    ];
}

function publishTodos(todos: TodoItem[], onProgress: ProgressHandler) {
    onProgress(todos.map(item => ({ ...item })));
}
