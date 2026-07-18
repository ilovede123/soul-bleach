// 模型补全接口，负责发送请求并接收流式消息
import { completion } from './request';
// 文件操作工具集合：搜索文件、列出目录、按行号读取文件
import { beginFileChangeSet, findFiles, finishFileChangeSet, getCurrentFileChangeSet, listFiles, readFileWithLineNumbers } from './tool';
// 上下文压缩：在会话消息过长时进行裁剪，避免超出模型上下文窗口
import { compactMessages } from './agent/context';
// 任务规划相关：创建计划、设置当前/最终待办、判断是否需要规划
import { createPlan, completeAllTodos, setActiveTodo, setActiveTodoByTool, setFinalTodo, shouldCreatePlan, updateTodoProgress } from './agent/planner';
// 初始消息，定义会话启动时的基础行为
import { createInitialMessages } from './agent/prompts';
// Agent 可用的工具声明列表及工具执行入口
import { executeAgentTool, getAgentTools } from './agent/tools';
// 类型定义：进度回调与待办项
import { AgentTaskResources, FileProgressHandler, FileTaskStatus, ProgressHandler, TodoItem } from './agent/types';
import { FileTaskTracker } from './agent/work-items';
import { AgentRunState, AgentSessionSnapshot, SessionStateHandler, ValidationRecord } from './agent/types';
import { runValidationPipeline } from './agent/validation';
import { reviewChanges } from './agent/reviewer';
import { loadAgentGuidance } from './agent/guidance';
import { runSubagents } from './agent/subagent';
import { cloneRunState, createRunState, restoreRunState } from './agent/run-state';
import { ToolEfficiencyTracker } from './agent/tool-efficiency';
import { parseToolArguments } from './agent/tool-arguments';
import {
    AGENT_ITERATIONS_PER_CHECKPOINT,
    AUTO_CONTINUE_MARKER,
    getRunBudgetEvent,
    MAX_AGENT_ITERATIONS_PER_RUN,
    MAX_AUTOMATIC_CHECKPOINTS,
    ProgressWatchdog,
    RUN_BUDGET_WARNING_AT,
    RUN_BUDGET_WARNING_MARKER
} from './agent/run-budget';

export { AgentDocumentInput, AgentImageInput, AgentTaskResources, TodoItem } from './agent/types';

/**
 * author:dengwei date:2026-07-08
 * Agent 主流程入口。
 * 这里保留会话状态、模型循环和工具调用调度，
 * 具体工具声明、基础消息、任务规划和上下文压缩已经拆到独立模块。
 */
// 本地文件回退结果的标记前缀，用于在消息中标识自动读取的文件内容
const LOCAL_FILE_RESULT_MARKER = '[Soul Bleach Local File Result]';
// 同一个工具错误连续出现的最大次数，超过后停止循环避免死循环
const MAX_REPEATED_TOOL_ERRORS = 3;
// 修改后自检消息的标记前缀，用于避免同一次任务里重复催促
const POST_EDIT_CHECK_MARKER = '[Soul Bleach Post Edit Check]';
// 执行计划标记。计划会加入模型上下文，而不再只用于界面展示
const EXECUTION_PLAN_MARKER = '[Soul Bleach Execution Plan]';

/** 单段执行预算耗尽时进入可恢复的暂停状态，而不是把长任务判定为失败。 */
class AgentPauseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AgentPauseError';
    }
}

/**
 * Agent 会话类。
 * 维护跨轮次的对话消息列表，支持在同一会话中多次执行任务，
 * 每次任务结束后自动压缩历史消息以控制上下文长度。
 */
export class AgentSession {
    // 会话消息列表，初始包含基础消息，随任务执行不断追加 user/assistant/tool 消息
    private messages: any[];
    private runState: AgentRunState | undefined;

    constructor(savedState?: AgentSessionSnapshot | any[], private readonly onStateChange?: SessionStateHandler) {
        const initialMessages = createInitialMessages();
        const savedMessages = Array.isArray(savedState) ? savedState : savedState?.messages;
        const history = Array.isArray(savedMessages)
            ? savedMessages.filter(message => message && message.role !== 'system')
            : [];
        this.messages = [...initialMessages, ...history];
        if (!Array.isArray(savedState) && savedState?.runState) {
            this.runState = restoreRunState(savedState.runState);
        }
        this.trimMessages();
    }

    /** 清空会话历史，重置为初始基础消息 */
    clear() {
        this.messages = createInitialMessages();
        this.runState = undefined;
        this.publishState();
    }

    /** 导出适合写入 workspaceState 的会话内容，不保存图片 Base64。 */
    exportState(): AgentSessionSnapshot {
        return {
            version: 2,
            messages: compactMessages(this.messages).map(message => ({
                ...message,
                content: sanitizePersistedContent(message.content)
            })),
            runState: this.runState ? cloneRunState(this.runState) : undefined
        };
    }

    getRunState(): AgentRunState | undefined {
        return this.runState ? cloneRunState(this.runState) : undefined;
    }

    /**
     * 执行一次 Agent 任务。
     * @param task 用户输入的任务描述
     * @param onChunk 流式输出回调，每收到一段文本就调用
     * @param signal 中断信号，用于支持用户取消
     * @param onProgress 进度回调，用于更新待办列表状态
     * @returns 模型最终回复的文本
     */
    async run(
        task: string,
        onChunk?: (text: string) => void,
        signal?: AbortSignal,
        onProgress?: ProgressHandler,
        resources?: AgentTaskResources,
        onFileProgress?: FileProgressHandler
    ): Promise<string> {
        // 根据任务复杂度判断是否需要创建待办计划
        const todos = await createTodosIfNeeded(task, signal, onProgress);
        this.runState = createRunState(task, todos ?? []);
        const trackedProgress = this.createProgressHandler(onProgress);
        // 把用户需求和执行计划合并成同一条 user 消息，避免在对话中间插入 system 角色
        this.messages.push({ role: 'user', content: createTaskMessage(task, todos, resources) });
        this.publishState();
        // 每次任务独立记录修改快照，无论成功、失败或取消都保留可撤销信息
        beginFileChangeSet();
        try {
            // 进入 Agent 主循环，反复调用模型和工具直到任务完成
            const result = await runAgentLoop(
                this.messages,
                onChunk,
                signal,
                todos,
                trackedProgress,
                onFileProgress,
                undefined,
                event => this.updateRunState(event)
            );
            completeAllTodos(todos, trackedProgress);
            this.updateRunState({ status: 'completed', lastError: undefined });
            return result;
        } catch (error: any) {
            this.updateRunState({
                status: error?.name === 'AgentPauseError' ? 'paused' : error?.name === 'AbortError' ? 'cancelled' : 'failed',
                lastError: error?.message ?? String(error)
            });
            throw error;
        } finally {
            finishFileChangeSet();
            this.trimMessages();
            this.publishState();
        }
    }

    /** 从持久化的运行状态继续执行，不重复创建用户任务和计划。 */
    async resume(
        onChunk?: (text: string) => void,
        signal?: AbortSignal,
        onProgress?: ProgressHandler,
        onFileProgress?: FileProgressHandler
    ): Promise<string> {
        if (!this.runState || !['paused', 'failed', 'cancelled'].includes(this.runState.status)) {
            throw new Error('当前没有可以继续的任务。');
        }

        this.runState.status = 'running';
        this.runState.lastError = undefined;
        this.runState.updatedAt = Date.now();
        const todos = this.runState.plan.map(item => ({ ...item }));
        const trackedProgress = this.createProgressHandler(onProgress);
        onProgress?.(todos.map(item => ({ ...item })));
        onFileProgress?.(this.runState.fileTasks.map(item => ({ ...item })));
        this.messages.push({
            role: 'user',
            content: '[Soul Bleach Resume]\n请根据已保存的计划、工具结果和文件任务状态，从中断位置继续执行，不要重复已经完成的工作。'
        });
        this.publishState();

        beginFileChangeSet();
        try {
            const result = await runAgentLoop(
                this.messages,
                onChunk,
                signal,
                todos,
                trackedProgress,
                onFileProgress,
                {
                    iteration: this.runState.iteration,
                    fileTasks: this.runState.fileTasks,
                    changedFiles: this.runState.changedFiles,
                    task: this.runState.task
                },
                event => this.updateRunState(event)
            );
            completeAllTodos(todos, trackedProgress);
            this.updateRunState({ status: 'completed', lastError: undefined });
            return result;
        } catch (error: any) {
            this.updateRunState({
                status: error?.name === 'AgentPauseError' ? 'paused' : error?.name === 'AbortError' ? 'cancelled' : 'failed',
                lastError: error?.message ?? String(error)
            });
            throw error;
        } finally {
            finishFileChangeSet();
            this.trimMessages();
            this.publishState();
        }
    }

    /** 压缩会话消息列表，避免上下文超出模型窗口 */
    private trimMessages() {
        this.messages = compactMessages(this.messages);
    }

    private createProgressHandler(onProgress?: ProgressHandler): ProgressHandler {
        return items => {
            if (this.runState) {
                this.runState.plan = items.map(item => ({ ...item }));
                this.runState.updatedAt = Date.now();
            }
            onProgress?.(items);
            this.publishState();
        };
    }

    private updateRunState(event: Partial<AgentRunState> & { validation?: ValidationRecord }) {
        if (!this.runState) {
            return;
        }
        if (event.validation) {
            this.runState.validations.push({ ...event.validation });
        }
        const { validation: _validation, ...statePatch } = event;
        Object.assign(this.runState, statePatch, { updatedAt: Date.now() });
        this.publishState();
    }

    private publishState() {
        void this.onStateChange?.(this.exportState());
    }
}

/**
 * 一次性执行 Agent 任务的便捷函数（无状态）。
 * 每次调用都创建全新的消息列表，适合不需要保留会话历史的场景。
 * @param task 用户输入的任务描述
 * @param onChunk 流式输出回调
 * @param signal 中断信号
 * @param onProgress 进度回调
 * @returns 模型最终回复的文本
 */
export async function runAgent(task: string, onChunk?: (text: string) => void, signal?: AbortSignal, onProgress?: ProgressHandler): Promise<string> {
    const messages: any[] = createInitialMessages();
    const todos = await createTodosIfNeeded(task, signal, onProgress);
    messages.push({ role: 'user', content: createTaskMessage(task, todos) });
    beginFileChangeSet();
    let result: string;
    try {
        result = await runAgentLoop(messages, onChunk, signal, todos, onProgress);
    } finally {
        finishFileChangeSet();
    }
    completeAllTodos(todos, onProgress);
    return result;
}

/**
 * 根据任务描述判断是否需要创建待办计划。
 * 简单任务跳过规划直接执行；复杂任务先分解为步骤再逐步推进。
 * @param task 用户任务描述
 * @param signal 中断信号
 * @param onProgress 进度回调
 * @returns 待办列表，若不需要规划则返回 undefined
 */
async function createTodosIfNeeded(task: string, signal?: AbortSignal, onProgress?: ProgressHandler): Promise<TodoItem[] | undefined> {
    // 判断任务复杂度，简单任务不需要创建计划
    if (!shouldCreatePlan(task)) {
        onProgress?.([]);
        return undefined;
    }

    // 调用模型将任务分解为待办步骤
    const todos = await createPlan(task, signal);
    // 将第一个待办设为活跃状态
    setActiveTodo(todos, onProgress, 0);
    return todos;
}

function sanitizePersistedContent(content: unknown): unknown {
    if (!Array.isArray(content)) {
        return content;
    }

    const imageCount = content.filter(item => item?.type === 'image_url').length;
    const textItems = content
        .filter(item => item?.type === 'text')
        .map(item => ({ type: 'text', text: String(item.text ?? '') }));
    if (imageCount > 0) {
        textItems.push({ type: 'text', text: `[历史消息中曾上传 ${imageCount} 张图片，图片数据未持久化]` });
    }
    return textItems;
}

/**
 * 生成发送给执行模型的任务消息。
 * 用户原始需求和执行计划放在同一条 user 消息中，既能让模型掌握完整步骤，
 * 也能兼容要求 system 角色只能出现在消息开头的 OpenAI-compatible 服务。
 * @param task 用户原始需求
 * @param todos Planner 生成的待办步骤
 * @param resources 用户上传的图片和通过 @ 引用的文件
 * @returns 纯文本消息或 OpenAI-compatible 多模态内容数组
 */
function createTaskMessage(task: string, todos?: TodoItem[], resources?: AgentTaskResources): string | any[] {
    const referencedFiles = resources?.referencedFiles?.filter(Boolean) ?? [];
    const images = resources?.images?.filter(image => image.dataUrl) ?? [];
    const documents = resources?.documents?.filter(document => document.text) ?? [];
    const planLines = todos?.map((todo, index) => `${index + 1}. ${todo.title}`) ?? [];
    const textParts = [task];
    const guidance = loadAgentGuidance(referencedFiles);

    if (guidance) {
        textParts.push('', '[Soul Bleach Repository Guidance]', guidance);
    }

    if (referencedFiles.length > 0) {
        textParts.push(
            '',
            '[Soul Bleach Referenced Files]',
            '用户通过 @ 明确引用了下面的工作区文件。处理需求前优先直接读取这些路径，不要重新猜测文件名：',
            ...referencedFiles.map(file => `- ${file}`)
        );
    }

    if (documents.length > 0) {
        textParts.push('', '[Soul Bleach Uploaded Documents]');
        for (const document of documents) {
            textParts.push(
                `\n--- 上传文件: ${document.name} ---`,
                document.text,
                `--- 文件结束: ${document.name} ---`
            );
        }
    }

    if (planLines.length > 0) {
        textParts.push(
            '',
            EXECUTION_PLAN_MARKER,
            '下面是本次任务的完整执行计划。它不仅用于界面展示，也是判断任务是否完成的依据：',
            ...planLines,
            '开始执行每个步骤前，必须调用 update_plan，并把该步骤从 1 开始的序号传入 activeStep。',
            '处理长任务时必须持续使用工具推进。只有确认原始需求和全部计划步骤都完成后，才能输出最终总结。'
        );
    }

    const textContent = textParts.join('\n');
    if (images.length === 0) {
        return textContent;
    }

    return [
        { type: 'text', text: textContent },
        ...images.map(image => ({
            type: 'image_url',
            image_url: { url: image.dataUrl }
        }))
    ];
}

/**
 * 在长任务循环中原地压缩消息。
 * 必须原地替换数组内容，才能让 AgentSession 持有的同一个消息数组同步获得压缩结果。
 * @param messages 当前会话消息
 */
function compactMessagesInPlace(messages: any[]) {
    const compactedMessages = compactMessages(messages);
    if (compactedMessages === messages) {
        return;
    }

    messages.splice(0, messages.length, ...compactedMessages);
}

/**
 * Agent 主循环：反复调用模型并执行工具，直到模型不再发起工具调用或达到迭代上限。
 *
 * 每轮迭代流程：
 * 1. 调用模型获取回复（可能包含文本和工具调用）
 * 2. 若无工具调用：
 *    - 尝试本地文件回退（模型未调用工具但用户要求查看文件时自动读取）
 *    - 检查空回复并抛出错误
 *    - 若模型只说"我来查看"却没实际调用工具，则催促它直接调用
 *    - 否则视为任务完成，返回最终文本
 * 3. 若有工具调用：逐一执行每个工具，将结果追加到消息列表
 * 4. 同一工具连续出错超过阈值时停止循环，避免死循环
 *
 * @param messages 对话消息列表（会被原地修改）
 * @param onChunk 流式输出回调
 * @param signal 中断信号
 * @param todos 待办列表，用于更新进度
 * @param onProgress 进度回调
 * @returns 模型最终回复文本或停止原因说明
 */
async function runAgentLoop(
    messages: any[],
    onChunk?: (text: string) => void,
    signal?: AbortSignal,
    todos?: TodoItem[],
    onProgress?: ProgressHandler,
    onFileProgress?: FileProgressHandler,
    resumeState?: { iteration: number; fileTasks: any[]; changedFiles: string[]; task?: string },
    onRunState?: (event: Partial<AgentRunState> & { validation?: ValidationRecord }) => void
): Promise<string> {
    // 上一次工具错误的标识，用于检测是否为重复错误
    let lastToolError = '';
    // 同一工具错误连续出现的次数
    let repeatedToolErrors = 0;
    // 本轮任务中被修改过的文件路径
    const changedFiles = new Set<string>(resumeState?.changedFiles ?? []);
    // 修改后已经重新读取确认过的文件路径
    const confirmedFiles = new Set<string>();
    // 修改后是否已经运行过验证命令
    let hasPostEditValidation = false;
    // 每次成功修改文件后递增，用来判断模型结束前是否检查过最新一批修改
    let editRevision = 0;
    // 最近一次完成检查所覆盖的修改版本；只有新修改出现时才会再次要求检查
    let reviewedEditRevision = 0;
    // 程序控制的验证和独立审查分别记录覆盖到哪个修改版本。
    let validatedRevision = 0;
    let lastValidationPassed = true;
    let independentlyReviewedRevision = 0;
    let lastReviewApproved = true;
    // 模型是否已经主动调用 update_plan；主动上报后不再使用工具名猜测进度
    let hasExplicitPlanProgress = false;
    // 批量目录任务由程序持有文件清单，完成判定不再依赖模型记忆
    const fileTaskTracker = new FileTaskTracker(items => {
        onFileProgress?.(items);
        onRunState?.({ fileTasks: items });
    }, resumeState?.fileTasks ?? []);
    // 根据当前运行中的真实调用模式提醒模型合并小补丁、避免重复读取。
    const toolEfficiency = new ToolEfficiencyTracker();
    // 只把新的有效工具操作视为进展，防止模型靠重复读取无限刷新执行预算。
    const progressWatchdog = new ProgressWatchdog();
    let hasRequestedFileTaskCreation = false;
    const taskForToolRouting = resumeState?.task ?? getLatestUserTask(messages);

    // iteration 跨恢复累计；localIteration 覆盖多个自动检查点，用户无需在每 80 轮手动继续。
    const completedIterations = resumeState?.iteration ?? 0;
    for (let localIteration = 0; localIteration < MAX_AGENT_ITERATIONS_PER_RUN; localIteration++) {
        const totalIteration = completedIterations + localIteration;
        // 每轮开始前检查是否已被用户取消
        throwIfAborted(signal);
        if (progressWatchdog.isStalled(localIteration)) {
            throw new AgentPauseError([
                `任务已暂停：连续 ${progressWatchdog.getIdleIterations(localIteration)} 轮没有发现新的有效进展。`,
                '运行时检测到模型可能在重复读取、重复说明下一步或循环调用相同工具。',
                '当前计划和文件状态已经保存。请检查任务范围、模型能力或最近的工具错误后再继续。'
            ].join('\n'));
        }
        onRunState?.({ iteration: totalIteration + 1 });

        const budgetEvent = getRunBudgetEvent(localIteration);
        if (budgetEvent === 'checkpoint') {
            messages.push({
                role: 'user',
                content: `${AUTO_CONTINUE_MARKER}\n运行时已自动保存状态并进入下一个执行段。任务仍在同一次运行中，请沿用现有计划和证据继续推进，不要重复已经完成的工作。`
            });
        } else if (budgetEvent === 'warning') {
            messages.push({
                role: 'user',
                content: `${RUN_BUDGET_WARNING_MARKER}\n本次自动执行还剩 ${RUN_BUDGET_WARNING_AT} 轮。请停止扩大调查范围，优先完成剩余修改、验证和最终答复；不要重复读取已经确认的内容。`
            });
        }

        // 长任务会产生大量工具消息，在循环中及时压缩旧上下文，避免请求越来越大
        compactMessagesInPlace(messages);

        // 调用模型获取本轮回复（可能包含文本内容 + 工具调用）
        const message = await completion(messages, getAgentTools(taskForToolRouting), onChunk, signal);
        messages.push(message);

        // —— 分支一：模型没有发起工具调用 ——
        if (!message.tool_calls || message.tool_calls.length === 0) {
            // 用户要求查看文件但模型未调用工具时，自动读取本地文件作为回退
            if (shouldUseLocalFileFallback(messages, message)) {
                const result = executeLocalFileFallback(messages);
                progressWatchdog.observe(localIteration + 1, `local-file-fallback:${result.slice(0, 500)}`);
                messages.push({
                    role: 'user',
                    content: `${LOCAL_FILE_RESULT_MARKER}\n${result}\n\n请基于上面的本地文件结果继续回答用户。`
                });
                continue;
            }

            // 模型既无内容也无工具调用，说明响应异常，抛出错误
            if (!message.content) {
                throw new Error(createEmptyResponseError(message));
            }

            // 模型只说"我来查看文件"但没实际调用工具，催促它直接使用工具
            if (shouldContinueForToolUse(messages, message.content)) {
                messages.push({
                    role: 'user',
                    content: '请不要只说明将要查看文件。请直接调用可用工具查找或读取相关文件，然后基于工具结果回答。'
                });
                continue;
            }

            // 主循环始终绑定启动本次运行的原始需求，不能把验证结果、审查意见等内部消息误当成新任务。
            const originalTask = taskForToolRouting;
            if (requiresFileTaskList(originalTask) && !fileTaskTracker.hasTasks) {
                if (hasRequestedFileTaskCreation) {
                    throw new Error('批量任务没有创建文件清单。请明确提供目标目录，或缩小任务范围后重试。');
                }
                hasRequestedFileTaskCreation = true;
                messages.push({
                    role: 'user',
                    content: '这是批量文件任务。请先调用 create_file_tasks，传入目标目录和扩展名，建立真实文件清单后再继续。'
                });
                continue;
            }

            if (fileTaskTracker.hasOpenTasks) {
                messages.push({ role: 'user', content: fileTaskTracker.createRemainingMessage() });
                continue;
            }

            // 只要最新一批修改还没有经过完成检查，就不能把阶段性说明当成最终答案
            if (shouldRequestPostEditCheck(changedFiles, editRevision, reviewedEditRevision)) {
                reviewedEditRevision = editRevision;
                messages.push({
                    role: 'user',
                    content: createPostEditCheckMessage(changedFiles, confirmedFiles, hasPostEditValidation, todos)
                });
                continue;
            }

            if (changedFiles.size > 0 && validatedRevision < editRevision) {
                const validation = runValidationPipeline([...changedFiles]);
                progressWatchdog.observe(localIteration + 1, `validation:${editRevision}:${validation.passed}`);
                validatedRevision = editRevision;
                lastValidationPassed = validation.passed;
                for (const record of validation.records) {
                    onRunState?.({ validation: record });
                }
                messages.push({
                    role: 'user',
                    content: [
                        '[Soul Bleach Deterministic Validation]',
                        validation.passed ? '程序验证已通过。' : '程序验证失败，必须根据下面的错误继续修复，不能直接结束。',
                        validation.summary
                    ].join('\n')
                });
                continue;
            }

            if (!lastValidationPassed) {
                throw new Error('任务修改没有变化，但确定性验证仍然失败。请查看验证输出后缩小任务范围重试。');
            }

            if (changedFiles.size > 0 && independentlyReviewedRevision < editRevision) {
                const review = await reviewChanges(originalTask, getCurrentFileChangeSet(), signal);
                progressWatchdog.observe(localIteration + 1, `independent-review:${editRevision}:${review.approved}`);
                independentlyReviewedRevision = editRevision;
                lastReviewApproved = review.approved;
                if (!review.approved) {
                    messages.push({
                        role: 'user',
                        content: [
                            '[Soul Bleach Independent Review]',
                            '独立审查发现必须修复的问题：',
                            ...review.issues.map(issue => `- ${issue}`),
                            review.summary,
                            '请根据证据修改代码并重新验证。'
                        ].join('\n')
                    });
                    continue;
                }
            }

            if (!lastReviewApproved) {
                throw new Error('独立审查的问题尚未通过代码修改解决，任务已停止。');
            }

            // 模型给出了最终文本回复，标记最后一个待办并返回
            setFinalTodo(todos, onProgress);
            return message.content ?? '';
        }

        // —— 分支二：模型发起了工具调用，逐一执行 ——
        for (const toolCall of message.tool_calls) {
            // 执行每个工具前也检查取消信号
            throwIfAborted(signal);

            const name = toolCall.function?.name;
            const rawArgs = toolCall.function?.arguments || '{}';
            let result: string;

            try {
                // 解析工具参数（含 JSON 修复逻辑）
                const args = parseToolArguments(name, rawArgs);
                // 将修复后的参数写回，保持消息一致性
                if (toolCall.function) {
                    toolCall.function.arguments = JSON.stringify(args);
                }
                if (name === 'create_file_tasks') {
                    result = fileTaskTracker.create(
                        String(args.path ?? '.'),
                        Array.isArray(args.extensions) ? args.extensions.map(String) : [],
                        Number(args.maxFiles) || 200
                    );
                } else if (name === 'delegate_tasks') {
                    const delegatedTasks = Array.isArray(args.tasks)
                        ? args.tasks.map((item: any) => ({ role: String(item.role), task: String(item.task) }))
                        : [];
                    result = await runSubagents(taskForToolRouting, delegatedTasks as any, signal, items => {
                        onRunState?.({ subagents: items });
                    });
                } else if (name === 'update_file_task') {
                    result = fileTaskTracker.update(
                        String(args.path ?? ''),
                        String(args.status ?? 'pending') as FileTaskStatus,
                        args.note === undefined ? undefined : String(args.note)
                    );
                } else if (name === 'update_plan') {
                    // 执行模型主动上报当前步骤，这是计划进度的主要数据来源
                    result = updateTodoProgress(todos, onProgress, Number(args.activeStep));
                    hasExplicitPlanProgress = Boolean(todos?.length);
                } else {
                    // 尚未收到主动进度上报时，继续用工具类型推断作为兼容兜底
                    if (!hasExplicitPlanProgress) {
                        setActiveTodoByTool(todos, onProgress, name);
                    }

                    // 执行文件或命令工具并获取结果
                    result = await executeAgentTool(name, args);
                    updatePostEditState(name, args, changedFiles, confirmedFiles, () => {
                        hasPostEditValidation = true;
                    });
                    fileTaskTracker.observeTool(name, args);
                    if (name === 'run_command') {
                        onRunState?.({
                            validation: {
                                command: String(args.command ?? ''),
                                passed: /退出码:\s*0/.test(result),
                                summary: result.slice(0, 1200)
                            }
                        });
                    }
                }
                // 修改版本只在工具成功执行后递增，失败的替换不会触发虚假的完成检查
                if (name === 'apply_patch' || name === 'replace_range' || name === 'write_file') {
                    editRevision++;
                    onRunState?.({ changedFiles: [...changedFiles] });
                }
                const efficiencyNotice = toolEfficiency.observe(name, args);
                if (efficiencyNotice) {
                    result = `${result}\n\n${efficiencyNotice}`;
                }
                // 工具执行成功，重置错误计数
                progressWatchdog.observe(localIteration + 1, createToolProgressKey(name, args));
                lastToolError = '';
                repeatedToolErrors = 0;
            } catch (e: any) {
                // 工具执行失败，格式化错误信息返回给模型
                result = formatToolError(name, e);
                // 生成错误标识，用于检测是否为同一错误的重复出现
                const errorKey = getToolErrorKey(name, e);
                repeatedToolErrors = errorKey === lastToolError ? repeatedToolErrors + 1 : 1;
                lastToolError = errorKey;
            }

            // 将工具执行结果追加到消息列表，供模型下一轮参考
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result
            });

            // 同一工具连续出错超过阈值，停止循环避免死循环
            if (repeatedToolErrors >= MAX_REPEATED_TOOL_ERRORS) {
                throw new Error([
                    '任务已停止：同一个工具错误连续出现，继续重试会导致循环。',
                    '',
                    result,
                    '',
                    '建议：重新读取目标文件的最新行号和原始内容后，再重新发起修改。'
                ].join('\n'));
            }
        }
    }

    // 多个内部检查点均已自动跨越；只有达到真正的总安全上限才需要用户决定是否继续。
    throw new AgentPauseError([
        `任务已暂停：已经自动执行 ${MAX_AUTOMATIC_CHECKPOINTS} 个阶段（每阶段 ${AGENT_ITERATIONS_PER_CHECKPOINT} 轮），本次共 ${MAX_AGENT_ITERATIONS_PER_RUN} 轮，累计 ${completedIterations + MAX_AGENT_ITERATIONS_PER_RUN} 轮。`,
        '这是总成本安全上限，不是普通的阶段检查点。当前计划和文件进度已经保存，可以点击“继续任务”追加一段自动执行预算。',
        '如果任务仍频繁达到这个上限，建议检查文件任务是否过大，或模型是否产生了大量低效但参数不同的工具调用。'
    ].join('\n'));
}

/** 为成功工具调用生成进展键；相同工具和参数重复执行不会被当成新进展。 */
function createToolProgressKey(name: string | undefined, args: Record<string, any>): string {
    return `${name ?? 'unknown'}:${JSON.stringify(args)}`;
}

/** 判断用户需求是否属于必须建立真实文件清单的批量任务。 */
function requiresFileTaskList(task: string): boolean {
    return /整个|全部|所有|批量|文件夹|目录|每个|一组|一批|all\s+files|folder|directory|batch/i.test(task)
        && /文件|代码|组件|页面|注释|修改|处理|检查|重构|优化|file|component|code/i.test(task);
}

/**
 * 格式化工具执行失败的错误信息，返回给模型以便其在下一轮修正参数。
 * @param name 工具名称
 * @param error 捕获到的错误对象
 * @returns 格式化后的错误提示字符串
 */
function formatToolError(name: string | undefined, error: any): string {
    return [
        `工具执行失败: ${name ?? 'unknown'}`,
        error?.message ?? String(error),
        '请根据错误信息调整参数。如果是 replace_range 内容不一致，必须重新读取带行号的文件内容后再重试。'
    ].join('\n');
}

/**
 * 生成工具错误的唯一标识键，用于检测是否为同一个错误的重复出现。
 * 由工具名和错误信息拼接而成。
 * @param name 工具名称
 * @param error 错误对象
 * @returns 错误标识字符串
 */
function getToolErrorKey(name: string | undefined, error: any): string {
    return `${name ?? 'unknown'}:${error?.message ?? String(error)}`;
}

/**
 * 更新代码修改后的自检状态。
 * 修改工具会登记被改文件；读取工具会登记已确认文件；验证命令会登记已验证。
 * @param name 工具名称
 * @param args 工具参数
 * @param changedFiles 已修改文件集合
 * @param confirmedFiles 已重新读取确认的文件集合
 * @param markValidated 标记已运行验证命令的回调
 */
function updatePostEditState(
    name: string | undefined,
    args: Record<string, any>,
    changedFiles: Set<string>,
    confirmedFiles: Set<string>,
    markValidated: () => void
) {
    const path = normalizeToolPath(args.path);

    if (name === 'apply_patch' || name === 'replace_range' || name === 'write_file') {
        changedFiles.add(path);
        confirmedFiles.delete(path);
        return;
    }

    if ((name === 'read_file' || name === 'read_file_with_line_numbers') && changedFiles.has(path)) {
        confirmedFiles.add(path);
        return;
    }

    if (name === 'run_command' && changedFiles.size > 0) {
        markValidated();
    }
}

/**
 * 判断是否需要在最终回复前要求模型做一次修改后自检。
 * 每出现一批新修改就检查一次；如果没有新的修改，不会重复催促，避免陷入空循环。
 * @param changedFiles 已修改文件集合
 * @param editRevision 当前成功修改的版本号
 * @param reviewedEditRevision 最近一次检查所覆盖的修改版本号
 * @returns 是否需要继续要求自检
 */
function shouldRequestPostEditCheck(
    changedFiles: Set<string>,
    editRevision: number,
    reviewedEditRevision: number
): boolean {
    return changedFiles.size > 0 && editRevision > reviewedEditRevision;
}

/**
 * 生成修改后自检提示。
 * 这条消息只进入模型上下文，不直接暴露为用户输入，用来约束模型继续完成确认步骤。
 * @param changedFiles 已修改文件集合
 * @param confirmedFiles 已重新读取确认的文件集合
 * @param hasPostEditValidation 是否已运行验证命令
 * @param todos 本次任务计划，用于检查是否仍有遗漏步骤
 * @returns 自检提示文本
 */
function createPostEditCheckMessage(
    changedFiles: Set<string>,
    confirmedFiles: Set<string>,
    hasPostEditValidation: boolean,
    todos?: TodoItem[]
): string {
    const unconfirmedFiles = [...changedFiles].filter(file => !confirmedFiles.has(file));
    const planLines = todos?.map((todo, index) => `${index + 1}. ${todo.title}`) ?? [];
    const lines = [
        POST_EDIT_CHECK_MARKER,
        '你刚刚完成了一批文件修改。上一条文字只能视为阶段性说明，不能直接作为最终答案。',
        '请重新对照用户的原始需求和下面的完整计划，判断是否还有未处理的文件、代码区段或步骤：',
        ...planLines
    ];

    if (unconfirmedFiles.length > 0) {
        lines.push(`使用 read_file_with_line_numbers 重新读取这些文件的最新修改位置：${unconfirmedFiles.join(', ')}`);
    }

    if (!hasPostEditValidation) {
        lines.push('使用 run_command 执行合适的验证命令，例如 corepack pnpm run compile、pnpm run lint、pnpm run test 或 git diff --stat。');
    }

    lines.push('如果任务尚未完整完成，必须继续调用工具处理剩余内容；确认全部完成后，再用简洁中文总结修改和验证结果。');
    return lines.join('\n');
}

/**
 * 规范化工具参数里的路径，保证同一个文件在状态集合里使用同一种 key。
 * @param pathValue 工具参数中的 path 字段
 * @returns 规范化后的路径；没有路径时返回空字符串
 */
function normalizeToolPath(pathValue: unknown): string {
    return String(pathValue ?? '').replace(/\\/g, '/').trim();
}

/**
 * 判断模型是否只声明了意图（如"我来查看文件"）却没有实际调用工具。
 * 当用户要求文件操作且模型回复只停留在口头说明时返回 true，
 * 用于催促模型直接使用工具而非空谈。
 * @param messages 消息列表
 * @param content 模型本轮回复的文本内容
 * @returns 是否需要催促模型调用工具
 */
function shouldContinueForToolUse(messages: any[], content: string): boolean {
    const latestUserMessage = getLatestUserTask(messages);
    // 用户消息中是否包含文件、目录或项目结构相关意图
    const asksForFileWork = isFileWorkRequest(latestUserMessage);
    // 模型回复是否只是口头声明意图（"我来""我将"等）
    const onlyAnnouncesIntent = /我来|我将|我会|让我|帮你|查找并查看|查看.*文件|查找.*文件/.test(content);
    // 是否已经催促过一次，避免反复催促
    const alreadyRetried = messages.some(message => message.role === 'user' && String(message.content).includes('请不要只说明将要查看文件'));

    return asksForFileWork && onlyAnnouncesIntent && !alreadyRetried;
}

/**
 * 判断是否需要触发本地文件回退机制。
 * 当用户要求查看文件、模型却既没返回工具调用也没给出有效内容时，
 * 自动读取本地文件作为回退，确保用户能获得文件内容。
 * @param messages 消息列表
 * @param message 模型本轮回复
 * @returns 是否应执行本地文件回退
 */
function shouldUseLocalFileFallback(messages: any[], message: any): boolean {
    const latestUserMessage = getLatestUserTask(messages);
    // 用户是否要求文件、目录或项目结构操作
    const asksForFileWork = isFileWorkRequest(latestUserMessage);
    // 模型声明了要调用工具但实际没有返回工具调用
    const requestedToolCallWithoutPayload = message.finish_reason === 'tool_calls' && !message.tool_calls?.length;
    // 模型只给出了被动查看的回复而非实际工具调用
    const passiveLookupReply = message.content && shouldContinueForToolUse(messages, message.content);
    // 是否已经使用过本地文件回退，避免重复
    const alreadyUsedFallback = messages.some(item => item.role === 'user' && String(item.content).startsWith(LOCAL_FILE_RESULT_MARKER));

    return asksForFileWork && !alreadyUsedFallback && (requestedToolCallWithoutPayload || passiveLookupReply);
}

/**
 * 判断用户是否在要求查看项目文件、目录结构或代码内容。
 * 内网模型有时会返回 finish_reason=tool_calls 但不给具体工具参数，
 * 这里尽量把“目录、项目结构、有哪些文件”等表达也纳入本地回退。
 * @param text 用户真实输入
 * @returns 是否属于文件工作区相关请求
 */
function isFileWorkRequest(text: string): boolean {
    return /查看|读取|查找|分析|修改|打开|搜索|列出|目录|文件|代码|项目|结构|工作区|有哪些|有什么|read|find|search|list|file|code|project|workspace|directory|folder/i.test(text);
}

/**
 * 执行本地文件回退：从用户消息中提取文件名，尝试直接读取；
 * 若直接读取失败则通过 findFiles 搜索并读取第一个匹配文件。
 * @param messages 消息列表
 * @returns 读取到的文件内容或搜索结果
 */
function executeLocalFileFallback(messages: any[]): string {
    const task = getLatestUserTask(messages);
    // 从用户消息中提取文件名/路径
    const query = extractFileQuery(task);

    // 没有提取到文件名时，列出根目录文件供用户参考
    if (!query) {
        return [
            '用户要求查看代码，但没有提供明确文件名。',
            '当前工作区根目录文件如下：',
            listFiles('.')
        ].join('\n');
    }

    // 尝试直接读取用户指定的文件
    try {
        return [
            `已读取文件: ${query}`,
            readFileWithLineNumbers(query)
        ].join('\n');
    } catch {
        // 直接读取失败，通过文件名搜索查找匹配文件
        const found = findFiles(query, 10);
        const firstPath = getFirstFilePath(found);

        // 搜索也没有结果，返回搜索信息
        if (!firstPath) {
            return [
                `没有直接读取到文件: ${query}`,
                '搜索结果:',
                found
            ].join('\n');
        }

        // 读取搜索到的第一个文件
        return [
            `根据 "${query}" 找到并读取文件: ${firstPath}`,
            readFileWithLineNumbers(firstPath)
        ].join('\n');
    }
}

/**
 * 获取最近一次真实用户输入。
 * 系统在循环中会追加一些内部提示消息，例如催促模型调用工具、插入本地文件回退结果。
 * 这些内部消息不能当成用户原始需求，否则后续文件名提取和意图判断会偏离。
 * @param messages 当前会话消息列表
 * @returns 最近一次用户真实输入文本
 */
function getLatestUserTask(messages: any[]): string {
    const message = [...messages].reverse().find(item => {
        const content = String(item.content ?? '');
        return item.role === 'user'
            && !isInternalControlMessage(content);
    });

    // 多模态消息先提取 text 内容，再去掉内部执行计划，只保留用户原始需求和文件引用
    return getTextMessageContent(message?.content).split(EXECUTION_PLAN_MARKER)[0].trim();
}

/** 判断消息是否由运行时注入，仅用于控制循环而不是表达新的用户需求。 */
function isInternalControlMessage(content: string): boolean {
    const internalPrefixes = [
        LOCAL_FILE_RESULT_MARKER,
        POST_EDIT_CHECK_MARKER,
        '[Soul Bleach Resume]',
        '[Soul Bleach Deterministic Validation]',
        '[Soul Bleach Independent Review]',
        RUN_BUDGET_WARNING_MARKER,
        AUTO_CONTINUE_MARKER
    ];
    return internalPrefixes.some(prefix => content.startsWith(prefix))
        || content.includes('请不要只说明将要查看文件')
        || content.startsWith('这是批量文件任务。')
        || content.startsWith('仍有文件任务未完成');
}

/** 从字符串或多模态 content 数组中提取文本部分。 */
function getTextMessageContent(content: unknown): string {
    if (!Array.isArray(content)) {
        return String(content ?? '');
    }

    return content
        .filter(item => item?.type === 'text')
        .map(item => String(item.text ?? ''))
        .join('\n');
}

/**
 * 从用户输入中提取可能的文件路径或文件名。
 * 提取顺序：
 * 1. 优先读取引号中的文件名，例如 "src/agent.ts"
 * 2. 再匹配带扩展名的路径片段，例如 src/agent.ts
 * 3. 最后尝试从“文件 xxx”或“代码 xxx”这类中文表达中提取
 * @param text 用户输入文本
 * @returns 提取到的文件路径；提取失败时返回空字符串
 */
function extractFileQuery(text: string): string {
    // 优先匹配引号中的文件名，避免句子里的其他文字干扰路径识别
    const quoted = text.match(/["'`“”‘’]([^"'`“”‘’]+\.[\w-]+)["'`“”‘’]/)?.[1];
    if (quoted) {
        return quoted.trim();
    }

    // 匹配常见代码和配置文件扩展名，支持相对路径、目录分隔符和短横线
    const fileLike = text.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|html|css|scss|less|py|java|go|rs|vue|svelte|yml|yaml|toml|xml|txt|env)/i)?.[0];
    if (fileLike) {
        return fileLike.trim();
    }

    // 兜底处理“查看文件 xxx”“分析代码 xxx”这类没有引号的自然语言表达
    const namedFile = text.match(/(?:文件|代码)\s*[:：]?\s*([\w./\\-]+)/)?.[1];
    return namedFile?.trim() ?? '';
}

/**
 * 从 findFiles 的文本结果中取出第一个可读取文件路径。
 * 搜索结果里可能包含目录行和“没有找到”等提示，需要过滤掉。
 * @param searchResult 文件搜索工具返回的文本
 * @returns 第一个匹配文件路径；没有匹配时返回 undefined
 */
function getFirstFilePath(searchResult: string): string | undefined {
    return searchResult
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('[DIR]') && !line.startsWith('没有找到'))[0];
}

/**
 * 生成空响应错误说明。
 * 如果服务端明确返回 network_error、timeout 等结束原因，优先提示服务中断；
 * 否则展示原始流式片段，方便后续根据厂商响应结构补解析逻辑。
 * @param message 模型本轮返回的消息对象
 * @returns 面向用户展示的错误说明
 */
function createEmptyResponseError(message: any): string {
    const samples = message.debug?.samples;
    const finishReason = String(message.finish_reason ?? '');

    if (finishReason === 'tool_calls' && !message.tool_calls?.length) {
        return [
            '模型返回了工具调用结束标记，但没有返回具体工具名称和参数。',
            '这通常是内网模型服务的 tool_calls 流式格式不完整：finish_reason 是 tool_calls，但 choices[0].delta.tool_calls 为空。',
            '如果你问的是项目文件或目录，插件会尽量走本地回退；否则需要服务端返回完整的 tool_calls 数据。'
        ].join('\n');
    }

    if (/network_error|timeout|error/i.test(finishReason)) {
        return [
            `模型服务中断：${finishReason}`,
            '服务端结束了这次流式响应，但没有返回正文，也没有返回工具调用。',
            '这通常是模型服务或网关层的问题，不是插件没有解析 choices.delta.content。'
        ].join('\n');
    }

    if (!samples?.length) {
        return '模型没有返回可显示内容，也没有返回工具调用。请检查内网模型是否使用 OpenAI-compatible 流式格式，例如 data: {...}、choices[0].delta.content 或 choices[0].delta.tool_calls。';
    }

    return [
        '模型响应已收到，但没有解析出 content 或 tool_calls。',
        '下面是内网服务返回的原始片段，请按这个结构适配解析器：',
        ...samples.map((line: string, index: number) => `${index + 1}. ${line}`)
    ].join('\n');
}

/**
 * 检查当前任务是否被用户取消。
 * VS Code 面板里的停止按钮会触发 AbortController，这里统一转成 AbortError，
 * 上层捕获到 AbortError 后不会当作普通错误展示。
 * @param signal 中断信号
 */
function throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) {
        return;
    }

    const error = new Error('Request aborted.');
    error.name = 'AbortError';
    throw error;
}
