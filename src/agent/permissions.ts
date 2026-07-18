/**
 * author:dengwei date:2026-07-18
 * 工具权限审批。提供只读、工作区写入和逐次询问三种模式。
 */
import * as vscode from 'vscode';

export type PermissionMode = 'read-only' | 'workspace-write' | 'ask';

const WRITE_TOOLS = new Set(['apply_patch', 'replace_range', 'write_file']);

export async function ensureToolPermission(name: string | undefined, args: Record<string, any>) {
    const mode = vscode.workspace.getConfiguration('soul-bleach').get<PermissionMode>('permissionMode', 'workspace-write');
    const isWrite = WRITE_TOOLS.has(String(name));
    const isProcess = name === 'start_process' || name === 'stop_process';
    const isGitWrite = ['git_create_branch', 'git_commit', 'git_push', 'git_create_pr', 'git_create_worktree'].includes(String(name));
    const isMcp = String(name).startsWith('mcp__');

    if (mode === 'read-only' && (isWrite || isProcess || isGitWrite)) {
        throw new Error(`当前权限模式为只读，不允许执行 ${name}。`);
    }

    const needsApproval = (mode === 'ask' && isWrite) || isProcess || isGitWrite || isMcp;
    if (!needsApproval) {
        return;
    }

    const target = isWrite
        ? String(args.path ?? '未知文件')
        : String(args.command ?? args.sessionId ?? args.branch ?? args.title ?? '受控操作');
    const choice = await vscode.window.showWarningMessage(
        `灵境请求执行 ${name}: ${target}`,
        { modal: true, detail: 'VS Code 扩展没有操作系统级沙箱，请确认该操作符合你的预期。' },
        '允许一次'
    );
    if (choice !== '允许一次') {
        throw new Error(`用户拒绝执行 ${name}。`);
    }
}
