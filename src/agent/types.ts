/**
 * author:dengwei date:2026-07-08
 * Agent 内部共享类型。
 * 这些类型会被主循环、规划器和 VS Code 面板共同使用，集中放置可以减少模块之间的重复定义。
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export type TodoItem = {
    id: string;
    title: string;
    status: TodoStatus;
};

export type ProgressHandler = (items: TodoItem[]) => void;

/** 用户随任务上传的图片。 */
export type AgentImageInput = {
    name: string;
    dataUrl: string;
};

/** 扩展端从 Word、PPT、PDF 或文本附件中提取出的内容。 */
export type AgentDocumentInput = {
    name: string;
    text: string;
};

/** 用户在输入框中附加的资源。 */
export type AgentTaskResources = {
    images?: AgentImageInput[];
    documents?: AgentDocumentInput[];
    referencedFiles?: string[];
};

export type FileTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type FileTaskItem = {
    path: string;
    status: FileTaskStatus;
    note?: string;
};

export type FileProgressHandler = (items: FileTaskItem[]) => void;

export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type ValidationRecord = {
    command: string;
    passed: boolean;
    summary: string;
};

/** 可持久化的任务运行状态，用于扩展重启后恢复长任务。 */
export type AgentRunState = {
    runId: string;
    task: string;
    status: RunStatus;
    startedAt: number;
    updatedAt: number;
    iteration: number;
    plan: TodoItem[];
    fileTasks: FileTaskItem[];
    changedFiles: string[];
    validations: ValidationRecord[];
    subagents: SubagentActivity[];
    lastError?: string;
};

export type SubagentRole = 'explorer' | 'tester' | 'reviewer';

export type SubagentActivity = {
    id: string;
    role: SubagentRole;
    task: string;
    status: 'running' | 'completed' | 'failed';
    summary?: string;
};

export type AgentSessionSnapshot = {
    version: 2;
    messages: any[];
    runState?: AgentRunState;
};

export type SessionStateHandler = (snapshot: AgentSessionSnapshot) => void | PromiseLike<void>;
