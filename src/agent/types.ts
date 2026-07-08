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
