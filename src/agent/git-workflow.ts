/**
 * author:dengwei date:2026-07-18
 * 受控 Git 工作流。所有命令使用参数数组执行，不经过 shell 字符串拼接。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';

export function getGitStatus(): string {
    return runGit(['status', '--short', '--branch']);
}

export function getGitDiff(staged = false): string {
    return runGit(staged ? ['diff', '--cached'] : ['diff']);
}

export function createGitBranch(branch: string): string {
    validateBranch(branch);
    return runGit(['switch', '-c', branch]);
}

export function commitGitChanges(message: string, paths: string[]): string {
    if (!message.trim()) {
        throw new Error('提交说明不能为空。');
    }
    if (!Array.isArray(paths) || paths.length === 0) {
        throw new Error('提交前必须明确传入 paths，不能默认提交整个工作区。');
    }
    const safePaths = paths.map(validateRelativePath);
    runGit(['add', '--', ...safePaths]);
    return runGit(['commit', '-m', message.trim()]);
}

export function pushGitBranch(branch: string): string {
    validateBranch(branch);
    return runGit(['push', '-u', 'origin', branch]);
}

export function createGitWorktree(branch: string, base = 'HEAD'): string {
    validateBranch(branch);
    const root = getWorkspaceRoot();
    const repositoryKey = createHash('sha1').update(root).digest('hex').slice(0, 10);
    const target = path.join(os.tmpdir(), 'soul-bleach-worktrees', repositoryKey, branch.replace(/\//g, '-'));
    const output = runGit(['worktree', 'add', '-b', branch, target, base]);
    return `${output}\nworktree: ${target}`;
}

export function openPullRequest(title: string, body: string, base = 'master'): string {
    if (!title.trim()) {
        throw new Error('PR 标题不能为空。');
    }
    return runExecutable('gh', ['pr', 'create', '--title', title.trim(), '--body', body, '--base', base]);
}

function runGit(args: string[]): string {
    return runExecutable('git', args);
}

function runExecutable(executable: string, args: string[]): string {
    try {
        return execFileSync(executable, args, {
            cwd: getWorkspaceRoot(),
            encoding: 'utf-8',
            windowsHide: true,
            shell: false,
            timeout: 120_000,
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim() || '(命令执行成功，没有输出)';
    } catch (error: any) {
        const output = [error?.stdout, error?.stderr].filter(Boolean).map(String).join('\n').trim();
        throw new Error(output || error?.message || `${executable} 执行失败。`);
    }
}

function validateBranch(branch: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(branch) || branch.includes('..')) {
        throw new Error(`分支名称无效: ${branch}`);
    }
}

function validateRelativePath(filePath: string): string {
    const normalized = String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized === '..' || normalized.startsWith('../') || path.isAbsolute(normalized)) {
        throw new Error(`提交路径越界: ${filePath}`);
    }
    return normalized;
}

function getWorkspaceRoot(): string {
    if (!vscode.workspace.isTrusted) {
        throw new Error('当前工作区尚未受信任，不能执行 Git 写操作。');
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        throw new Error('没有打开的工作区。');
    }
    return root;
}
