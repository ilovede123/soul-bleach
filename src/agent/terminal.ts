/**
 * author:dengwei date:2026-07-18
 * 后台进程管理器，用于启动开发服务器并持续读取输出。
 */
import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomUUID } from 'crypto';

const MAX_OUTPUT = 30_000;
const ALLOWED_PROCESS_COMMANDS = [
    /^(corepack\s+)?pnpm\s+run\s+(dev|start|serve|preview)$/,
    /^npm\s+run\s+(dev|start|serve|preview)$/,
    /^yarn\s+(dev|start|serve|preview)$/
];

type ProcessSession = {
    id: string;
    command: string;
    process: ChildProcessWithoutNullStreams;
    output: string;
    readOffset: number;
    exitCode: number | null;
};

const sessions = new Map<string, ProcessSession>();

export function startProcess(command: string): string {
    const normalized = command.trim().replace(/\s+/g, ' ');
    if (!ALLOWED_PROCESS_COMMANDS.some(pattern => pattern.test(normalized))) {
        throw new Error('后台进程只允许启动 package.json 中的 dev、start、serve 或 preview 脚本。');
    }
    const root = getWorkspaceRoot();
    const [executable, ...args] = normalized.split(' ');
    const child = spawn(executable, args, {
        cwd: root,
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
    });
    const id = randomUUID();
    const session: ProcessSession = { id, command: normalized, process: child, output: '', readOffset: 0, exitCode: null };
    sessions.set(id, session);

    child.stdout.on('data', chunk => appendOutput(session, String(chunk)));
    child.stderr.on('data', chunk => appendOutput(session, String(chunk)));
    child.on('error', error => appendOutput(session, `\n[进程错误] ${error.message}\n`));
    child.on('exit', code => {
        session.exitCode = code ?? 1;
        appendOutput(session, `\n[进程结束] 退出码 ${session.exitCode}\n`);
    });

    return `后台进程已启动。sessionId=${id}\n命令: ${normalized}`;
}

export function readProcess(sessionId: string): string {
    const session = getSession(sessionId);
    const fresh = session.output.slice(session.readOffset);
    session.readOffset = session.output.length;
    return [
        `sessionId: ${session.id}`,
        `状态: ${session.exitCode === null ? '运行中' : `已结束(${session.exitCode})`}`,
        fresh || '(暂无新输出)'
    ].join('\n');
}

export function stopProcess(sessionId: string): string {
    const session = getSession(sessionId);
    if (session.exitCode !== null) {
        return `进程已经结束，退出码 ${session.exitCode}。`;
    }
    session.process.kill();
    return `已请求停止后台进程 ${sessionId}。`;
}

function appendOutput(session: ProcessSession, text: string) {
    session.output += text;
    if (session.output.length > MAX_OUTPUT) {
        const removed = session.output.length - MAX_OUTPUT;
        session.output = session.output.slice(removed);
        session.readOffset = Math.max(0, session.readOffset - removed);
    }
}

function getSession(sessionId: string): ProcessSession {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error(`后台进程不存在: ${sessionId}`);
    }
    return session;
}

function getWorkspaceRoot(): string {
    if (!vscode.workspace.isTrusted) {
        throw new Error('当前工作区尚未受信任，不能启动后台进程。');
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        throw new Error('没有打开的工作区。');
    }
    return root;
}
