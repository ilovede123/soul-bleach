/**
 * author:dengwei date:2026-07-08
 * 任务规划和进度状态管理。
 * createPlan 负责把用户需求拆成 todo，setActiveTodo/completeAllTodos 负责同步面板进度。
 */
import { completion } from '../request';
import { PLANNER_SYSTEM_PROMPT } from './prompts';
import { ProgressHandler, TodoItem, TodoStatus } from './types';

export function shouldCreatePlan(task: string): boolean {
    const text = task.trim();

    if (!text) {
        return false;
    }

    if (isSimpleChat(text)) {
        return false;
    }

    return isCodeOrFileTask(text) || isMultiStepTask(text) || text.length >= 80;
}

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

export function setActiveTodoByTool(todos: TodoItem[] | undefined, onProgress: ProgressHandler | undefined, toolName: string | undefined) {
    if (!todos?.length) {
        return;
    }

    const currentIndex = Math.max(0, todos.findIndex(item => item.status === 'in_progress'));
    const nextIndex = getTodoIndexForTool(todos, toolName);
    setActiveTodo(todos, onProgress, Math.max(currentIndex, nextIndex));
}

export function setFinalTodo(todos: TodoItem[] | undefined, onProgress: ProgressHandler | undefined) {
    if (!todos?.length) {
        return;
    }

    setActiveTodo(todos, onProgress, todos.length - 1);
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

function getTodoIndexForTool(todos: TodoItem[], toolName: string | undefined): number {
    const normalizedToolName = String(toolName ?? '');
    const titles = todos.map(item => item.title);

    if (/list_files|find_files|search_text|read_file|read_file_with_line_numbers/.test(normalizedToolName)) {
        return findFirstTodoIndex(titles, /定位|查找|搜索|读取|查看|上下文|分析|理解/) ?? 0;
    }

    if (/replace_range|write_file/.test(normalizedToolName)) {
        return findFirstTodoIndex(titles, /修改|写入|替换|实现|更新|执行|代码/) ?? Math.min(1, todos.length - 1);
    }

    if (/run_command/.test(normalizedToolName)) {
        return findFirstTodoIndex(titles, /验证|检查|编译|测试|lint|运行|确认/) ?? Math.max(0, todos.length - 2);
    }

    return Math.max(0, todos.findIndex(item => item.status === 'in_progress'));
}

function findFirstTodoIndex(titles: string[], pattern: RegExp): number | undefined {
    const index = titles.findIndex(title => pattern.test(title));
    return index >= 0 ? index : undefined;
}

function isSimpleChat(text: string): boolean {
    return /^(你好|您好|hi|hello|hey|在吗|谢谢|多谢|好的|好|ok|嗯|明白|收到|可以|测试|test)[。！!.\s]*$/i.test(text);
}

function isCodeOrFileTask(text: string): boolean {
    return /代码|文件|项目|目录|函数|变量|类型|组件|接口|报错|异常|bug|修复|修改|优化|重构|实现|新增|删除|替换|读取|查看|搜索|编译|测试|打包|提交|git|read|file|code|fix|update|implement|refactor|compile|test|build/i.test(text);
}

function isMultiStepTask(text: string): boolean {
    return /先.*再|然后|接着|最后|步骤|计划|拆解|todo|待办|流程|方案|规划/i.test(text);
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
