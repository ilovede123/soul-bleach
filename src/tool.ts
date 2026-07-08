import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const IGNORED_DIRS = new Set([
    '.git',
    'node_modules',
    'out',
    'dist',
    'build',
    '.vscode-test'
]);

function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new Error('没有打开的工作区');
    }
    return folders[0].uri.fsPath;
}

function getWorkspacePath(relativePath: string): string {
    const root = getWorkspaceRoot();
    const fullPath = path.resolve(root, relativePath || '.');
    const relative = path.relative(root, fullPath);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('路径越界，不允许访问工作区外的文件');
    }

    return fullPath;
}

function toWorkspaceRelativePath(fullPath: string): string {
    return path.relative(getWorkspaceRoot(), fullPath).replace(/\\/g, '/');
}

export function readFile(filePath: string): string {
    const fullPath = getWorkspacePath(filePath);

    if (!fs.existsSync(fullPath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    return fs.readFileSync(fullPath, 'utf-8');
}

export function writeFile(filePath: string, content: string): string {
    const fullPath = getWorkspacePath(filePath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return `已写入 ${filePath}`;
}

export function listFiles(dir: string): string {
    const fullPath = getWorkspacePath(dir || '.');

    if (!fs.existsSync(fullPath)) {
        throw new Error(`目录不存在: ${dir}`);
    }

    const items = fs.readdirSync(fullPath, { withFileTypes: true });
    return items
        .map(i => (i.isDirectory() ? `[DIR] ${i.name}` : i.name))
        .join('\n');
}
export function findFiles(query: string, maxResults = 30): string {
    const root = getWorkspaceRoot();
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
        throw new Error('搜索关键字不能为空');
    }

    const results: string[] = [];

    function walk(dir: string) {
        if (results.length >= maxResults) {
            return;
        }

        const items = fs.readdirSync(dir, { withFileTypes: true });

        for (const item of items) {
            if (results.length >= maxResults) {
                return;
            }

            if (item.isDirectory() && IGNORED_DIRS.has(item.name)) {
                continue;
            }

            const fullPath = path.join(dir, item.name);
            const relativePath = toWorkspaceRelativePath(fullPath);

            if (relativePath.toLowerCase().includes(normalizedQuery)) {
                results.push(item.isDirectory() ? `[DIR] ${relativePath}` : relativePath);
            }

            if (item.isDirectory()) {
                walk(fullPath);
            }
        }
    }

    walk(root);

    return results.length > 0
        ? results.join('\n')
        : `没有找到匹配文件: ${query}`;
}

export function readFileWithLineNumbers(filePath: string): string {
    const content = readFile(filePath);

    return content
        .split(/\r?\n/)
        .map((str, index) => `${index + 1} | ${str}`)
        .join('\n');
}


export function replaceRange(path: string, startLine: number, endLine: number, oldContent: string, newContent: string): string {
    const origin = readFile(path);
    const eol = origin.includes('\r\n') ? '\r\n' : '\n';
    const originArr = origin.split(/\r?\n/);

    if (startLine < 1) {
        throw Error('开始行数不能小于1');
    }
    if (endLine > originArr.length) {
        throw Error('删除的行数不能大于源文件总行数');
    }

    if (endLine < startLine) {
        throw Error('结束行不能小于开始行');
    }
    const startIndex = startLine - 1;
    const deleteCount = endLine - startLine + 1;
    const currentContent = originArr.slice(startIndex, startIndex + deleteCount).join('\n');
    const expectedContent = oldContent.replace(/\r\n/g, '\n');

    if (currentContent !== expectedContent) {
        throw Error([
            '替换失败：目标行内容和 oldContent 不一致，文件可能已经被前一次替换改变。',
            '请重新读取带行号的文件内容，再基于最新行号和最新 oldContent 调用 replace_range。',
            '当前目标行内容:',
            currentContent
        ].join('\n'));
    }

    const newContentArr = newContent.split(/\r?\n/);
    originArr.splice(startIndex, deleteCount, ...newContentArr);

    const newContentStr = originArr.join(eol);
    writeFile(path, newContentStr);
    return `已替换 ${path} 第 ${startLine}-${endLine} 行`;
}
