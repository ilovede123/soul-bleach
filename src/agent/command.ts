/**
 * author:dengwei date:2026-07-08
 * 受限命令执行工具。
 * 这里只允许运行编译、测试、lint 和只读 git 命令，避免模型执行高风险 shell 操作。
 */
import * as vscode from 'vscode';
import { execFileSync } from 'child_process';

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_COMMAND_OUTPUT_LENGTH = 12_000;

const ALLOWED_COMMANDS = [
    /^corepack\s+pnpm\s+run\s+(compile|test|lint|build)(\s+--[\w=-]+)*$/,
    /^pnpm\s+run\s+(compile|test|lint|build)(\s+--[\w=-]+)*$/,
    /^npm\s+run\s+(compile|test|lint|build)(\s+--[\w=-]+)*$/,
    /^yarn\s+(compile|test|lint|build)(\s+--[\w=-]+)*$/,
    /^git\s+status(\s+--short|\s+-sb)?$/,
    /^git\s+diff(\s+--\s+[\w./\\-]+)?$/,
    /^git\s+diff\s+--stat$/,
    /^git\s+log\s+--oneline(\s+--max-count=\d+)?$/
];

export function runCommand(command: string): string {
    const normalizedCommand = command.trim().replace(/\s+/g, ' ');

    if (!normalizedCommand) {
        throw new Error('命令不能为空');
    }

    if (!isAllowedCommand(normalizedCommand)) {
        throw new Error([
            `不允许执行该命令: ${command}`,
            '当前只允许编译、测试、lint、build 和只读 git 命令。',
            '示例: corepack pnpm run compile、pnpm run lint、git status --short、git diff --stat'
        ].join('\n'));
    }

    const root = getWorkspaceRoot();
    const { executable, args } = parseCommand(normalizedCommand);

    try {
        const output = execFileSync(executable, args, {
            cwd: root,
            encoding: 'utf-8',
            timeout: COMMAND_TIMEOUT_MS,
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        return formatCommandResult(normalizedCommand, 0, output);
    } catch (error: any) {
        const status = typeof error?.status === 'number' ? error.status : 1;
        const stdout = String(error?.stdout ?? '');
        const stderr = String(error?.stderr ?? '');
        return formatCommandResult(normalizedCommand, status, [stdout, stderr].filter(Boolean).join('\n'));
    }
}

function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new Error('没有打开的工作区');
    }

    return folders[0].uri.fsPath;
}

function isAllowedCommand(command: string): boolean {
    return ALLOWED_COMMANDS.some(pattern => pattern.test(command));
}

function parseCommand(command: string): { executable: string; args: string[] } {
    const parts = command.split(' ');
    const executable = parts[0];
    const args = parts.slice(1);

    return { executable, args };
}

function formatCommandResult(command: string, exitCode: number, output: string): string {
    const normalizedOutput = output.trim() || '(命令没有输出)';
    const truncatedOutput = normalizedOutput.length > MAX_COMMAND_OUTPUT_LENGTH
        ? `${normalizedOutput.slice(0, MAX_COMMAND_OUTPUT_LENGTH)}\n...输出过长，已截断`
        : normalizedOutput;

    return [
        `命令: ${command}`,
        `退出码: ${exitCode}`,
        '',
        truncatedOutput
    ].join('\n');
}
