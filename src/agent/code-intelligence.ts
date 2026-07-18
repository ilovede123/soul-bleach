/**
 * author:dengwei date:2026-07-18
 * 基于 VS Code 语言服务的代码理解工具，提供项目地图、符号搜索和诊断信息。
 */
import * as vscode from 'vscode';
import * as path from 'path';

const EXCLUDE_GLOB = '**/{node_modules,.git,out,dist,build,.vscode-test}/**';

export async function getProjectMap(maxFiles = 300): Promise<string> {
    const root = getWorkspaceRoot();
    const files = await vscode.workspace.findFiles('**/*', EXCLUDE_GLOB, Math.min(Math.max(maxFiles, 20), 800));
    const relativePaths = files.map(uri => path.relative(root, uri.fsPath).replace(/\\/g, '/')).sort();
    const groups = new Map<string, string[]>();
    for (const file of relativePaths) {
        const group = file.includes('/') ? file.split('/')[0] : '[root]';
        const items = groups.get(group) ?? [];
        items.push(file);
        groups.set(group, items);
    }

    return [...groups.entries()].map(([group, items]) => [
        `${group}/ (${items.length})`,
        ...items.slice(0, 80).map(item => `  ${item}`),
        items.length > 80 ? `  ...另有 ${items.length - 80} 个文件` : ''
    ].filter(Boolean).join('\n')).join('\n');
}

export async function findWorkspaceSymbols(query: string, maxResults = 50): Promise<string> {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', query);
    if (!symbols?.length) {
        return `语言服务没有找到符号: ${query}。可以继续使用 search_text 进行文本搜索。`;
    }
    const root = getWorkspaceRoot();
    return symbols.slice(0, Math.min(maxResults, 100)).map(symbol => {
        const location = symbol.location;
        const file = path.relative(root, location.uri.fsPath).replace(/\\/g, '/');
        return `${file}:${location.range.start.line + 1}:${location.range.start.character + 1} | ${symbol.name} | ${vscode.SymbolKind[symbol.kind]}`;
    }).join('\n');
}

export function getWorkspaceDiagnostics(filePath?: string, maxResults = 100): string {
    const root = getWorkspaceRoot();
    const entries: [vscode.Uri, readonly vscode.Diagnostic[]][] = filePath
        ? [[vscode.Uri.file(path.join(root, filePath)), vscode.languages.getDiagnostics(vscode.Uri.file(path.join(root, filePath)))]]
        : vscode.languages.getDiagnostics();
    const lines: string[] = [];

    for (const [uri, diagnostics] of entries) {
        const relative = path.relative(root, uri.fsPath).replace(/\\/g, '/');
        for (const diagnostic of diagnostics) {
            if (lines.length >= Math.min(maxResults, 300)) {
                break;
            }
            const severity = vscode.DiagnosticSeverity[diagnostic.severity];
            lines.push(`${relative}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} | ${severity} | ${diagnostic.message}`);
        }
    }
    return lines.length > 0 ? lines.join('\n') : '当前 VS Code 语言服务没有报告诊断问题。';
}

function getWorkspaceRoot(): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        throw new Error('没有打开的工作区。');
    }
    return root;
}
