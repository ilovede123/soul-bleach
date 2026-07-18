/**
 * author:dengwei date:2026-07-18
 * 扩展诊断日志，只记录请求结构和状态，不记录密钥、提示词或文件内容。
 */
import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initializeDiagnostics(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('灵境诊断');
    context.subscriptions.push(outputChannel);
}

export function logDiagnostic(message: string) {
    const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
    outputChannel?.appendLine(`[${timestamp}] ${message}`);
}

export function showDiagnostics() {
    outputChannel?.show(true);
}
