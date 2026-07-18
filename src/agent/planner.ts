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

    // 用户明确要求执行修改、检查、构建等动作时直接创建计划，
    // 不再强制要求句子里同时出现“代码、文件、项目”等技术对象词
    if (isExplicitExecutionTask(text)) {
        return true;
    }

    if (isQuestionOnly(text)) {
        return false;
    }

    return isCodeWritingTask(text) || isEngineeringExecutionTask(text);
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

/**
 * 根据模型上报的步骤序号更新任务进度。
 * 这是进度更新的主要方式：执行模型最清楚自己正在处理哪个计划步骤，
 * 因此比根据 read_file、replace_range 等工具名称猜测进度更准确。
 * @param todos 当前任务的待办列表
 * @param onProgress 面板进度回调
 * @param activeStep 模型传入的步骤序号，从 1 开始
 * @returns 返回给模型的进度更新结果
 */
export function updateTodoProgress(
    todos: TodoItem[] | undefined,
    onProgress: ProgressHandler | undefined,
    activeStep: number
): string {
    if (!todos?.length) {
        return '当前任务没有执行计划，无需更新进度。';
    }

    if (!Number.isInteger(activeStep) || activeStep < 1 || activeStep > todos.length) {
        throw new Error(`计划步骤序号无效：${activeStep}。有效范围是 1-${todos.length}。`);
    }

    setActiveTodo(todos, onProgress, activeStep - 1);
    return `计划进度已更新：正在执行第 ${activeStep} 步“${todos[activeStep - 1].title}”。`;
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

/**
 * 判断用户是否明确要求 Agent 执行一项工作。
 * 常见自然表达不一定包含“代码、文件”等对象词，例如“给 App.vue 加中文注释”，
 * 只要同时存在命令语气和执行动作，就应该进入任务拆解。
 * @param text 用户输入
 * @returns 是否属于明确执行任务
 */
function isExplicitExecutionTask(text: string): boolean {
    const hasDirective = /帮我|请|麻烦|需要你|替我|直接|做一下|处理一下|跑一下|把|给/i.test(text);
    const hasAction = /编写|开发|实现|新增|添加|增加|补充|加.{0,6}注释|注释|修改|改成|改为|修复|优化|重构|删除|移除|替换|生成|完善|调整|接入|封装|抽离|拆分|检查|排查|验证|运行|编译|构建|打包|测试|提交|发布|安装|write|edit|fix|update|implement|refactor|add|remove|replace|build|test|run|commit|publish/i.test(text);
    const startsWithAction = /^(?:先|再|然后)?\s*(?:编写|开发|实现|新增|添加|增加|补充|注释|修改|修复|优化|重构|删除|移除|替换|生成|完善|调整|接入|封装|抽离|拆分|检查|排查|验证|运行|编译|构建|打包|测试|提交|发布|安装|write|edit|fix|update|implement|refactor|add|remove|replace|build|test|run|commit|publish)/i.test(text);

    return hasAction && (hasDirective || startsWithAction);
}

function isQuestionOnly(text: string): boolean {
    const looksLikeQuestion = /[?？]$|^(什么|为什么|为啥|怎么|如何|能不能|可不可以|可以吗|是否|是不是|有没有|哪里|哪|请问)/i.test(text)
        || /吗[？?。.\s]*$|呢[？?。.\s]*$/.test(text);
    const hasExecutionRequest = /帮我|给我|请.*(写|编写|开发|实现|新增|添加|修改|修复|优化|重构|删除|替换|运行|测试|打包|提交)|把.*(改|修|加|删|替换)|直接|做一下|处理一下|执行|跑一下/i.test(text);

    return looksLikeQuestion && !hasExecutionRequest;
}

function isCodeWritingTask(text: string): boolean {
    return /写|编写|开发|实现|新增|添加|修改|改成|改为|修复|优化|重构|删除|移除|替换|生成|完善|调整|接入|封装|抽离|拆分|write|edit|fix|update|implement|refactor|add|remove|replace/i.test(text)
        && /代码|文件|函数|组件|接口|页面|样式|逻辑|项目|插件|工具|配置|readme|package|code|file|function|component|api|style|project|extension|config/i.test(text);
}

function isEngineeringExecutionTask(text: string): boolean {
    return /编译|构建|打包|测试|运行|提交|发布|安装|验证|pnpm|npm|git|compile|build|package|test|run|commit|publish|install/i.test(text);
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
