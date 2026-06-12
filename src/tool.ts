import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new Error('没有打开的工作区');
    }
    return folders[0].uri.fsPath;
}

export function readFile(filePath: string): string {
    const root = getWorkspaceRoot();
    const fullPath = path.join(root, filePath);

    if (!fullPath.startsWith(root)) {
        throw new Error('路径越界，不允许访问工作区外的文件');
    }
    if (!fs.existsSync(fullPath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    return fs.readFileSync(fullPath, 'utf-8');
}

export function writeFile(filePath: string, content: string): string {
    const root = getWorkspaceRoot();
    const fullPath = path.join(root, filePath);

    if (!fullPath.startsWith(root)) {
        throw new Error('路径越界，不允许访问工作区外的文件');
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return `已写入 ${filePath}`;
}

export function listFiles(dir: string): string {
    const root = getWorkspaceRoot();
    const fullPath = path.join(root, dir);

    if (!fullPath.startsWith(root)) {
        throw new Error('路径越界');
    }
    if (!fs.existsSync(fullPath)) {
        throw new Error(`目录不存在: ${dir}`);
    }

    const items = fs.readdirSync(fullPath, { withFileTypes: true });
    return items
        .map(i => (i.isDirectory() ? `[DIR] ${i.name}` : i.name))
        .join('\n');
}