import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * author:dengwei date:2026-07-08
 * 工作区文件工具集合。
 * 所有读取统一使用 utf-8，并且所有路径都会限制在当前 VS Code 工作区内，
 * 防止模型传入越界路径访问项目外部文件。
 */
const IGNORED_DIRS = new Set([
    '.git',
    'node_modules',
    'out',
    'dist',
    'build',
    '.vscode-test'
]);

const DEFAULT_READ_MAX_LINES = 200;
const DEFAULT_SEARCH_MAX_RESULTS = 30;
const DEFAULT_SEARCH_CONTEXT_LINES = 2;
const MAX_SEARCH_FILE_SIZE = 1024 * 1024;

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

export function searchText(query: string, filePath?: string, maxResults = DEFAULT_SEARCH_MAX_RESULTS, contextLines = DEFAULT_SEARCH_CONTEXT_LINES): string {
    const normalizedQuery = query.trim().toLowerCase();
    const safeMaxResults = Math.max(1, Math.floor(Number(maxResults) || DEFAULT_SEARCH_MAX_RESULTS));
    const safeContextLines = Math.max(0, Math.min(5, Math.floor(Number(contextLines) || DEFAULT_SEARCH_CONTEXT_LINES)));
    const results: string[] = [];

    if (!normalizedQuery) {
        throw new Error('搜索内容不能为空');
    }

    const files = filePath
        ? [getWorkspacePath(filePath)]
        : collectSearchableFiles(getWorkspaceRoot(), safeMaxResults * 20);

    for (const fullPath of files) {
        if (results.length >= safeMaxResults) {
            break;
        }

        if (!fs.existsSync(fullPath)) {
            continue;
        }

        const stat = fs.statSync(fullPath);
        if (!stat.isFile() || stat.size > MAX_SEARCH_FILE_SIZE) {
            continue;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);

        for (let index = 0; index < lines.length; index++) {
            if (results.length >= safeMaxResults) {
                break;
            }

            if (!lines[index].toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            results.push(formatSearchMatch(fullPath, lines, index, safeContextLines));
        }
    }

    if (results.length === 0) {
        return filePath
            ? `没有在 ${filePath} 中找到: ${query}`
            : `没有在当前工作区中找到: ${query}`;
    }

    return [
        `搜索内容: ${query}`,
        `返回结果: ${results.length}/${safeMaxResults}`,
        '命中结果中的行号可继续传给 read_file_with_line_numbers 读取更完整上下文。',
        '',
        results.join('\n\n')
    ].join('\n');
}

function collectSearchableFiles(dir: string, maxFiles: number): string[] {
    const results: string[] = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
        if (results.length >= maxFiles) {
            break;
        }

        if (item.isDirectory() && IGNORED_DIRS.has(item.name)) {
            continue;
        }

        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
            results.push(...collectSearchableFiles(fullPath, maxFiles - results.length));
            continue;
        }

        if (isProbablyTextFile(item.name)) {
            results.push(fullPath);
        }
    }

    return results;
}

function isProbablyTextFile(fileName: string): boolean {
    return /\.(ts|tsx|js|jsx|json|md|html|css|scss|less|py|java|go|rs|vue|svelte|yml|yaml|toml|xml|txt|env|c|cpp|h|hpp|cs|php|rb|sh|ps1)$/i.test(fileName);
}

function formatSearchMatch(fullPath: string, lines: string[], matchIndex: number, contextLines: number): string {
    const startIndex = Math.max(0, matchIndex - contextLines);
    const endIndex = Math.min(lines.length - 1, matchIndex + contextLines);
    const relativePath = toWorkspaceRelativePath(fullPath);
    const body = lines
        .slice(startIndex, endIndex + 1)
        .map((line, index) => {
            const lineNumber = startIndex + index + 1;
            const marker = lineNumber === matchIndex + 1 ? '>' : ' ';
            return `${marker} ${lineNumber} | ${line}`;
        })
        .join('\n');

    return `${relativePath}:${matchIndex + 1}\n${body}`;
}

export function readFileWithLineNumbers(filePath: string, startLine = 1, endLine?: number, maxLines = DEFAULT_READ_MAX_LINES): string {
    const content = readFile(filePath);
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;
    const safeStartLine = Math.max(1, Math.floor(Number(startLine) || 1));
    const safeMaxLines = Math.max(1, Math.floor(Number(maxLines) || DEFAULT_READ_MAX_LINES));
    const requestedEndLine = endLine === undefined
        ? safeStartLine + safeMaxLines - 1
        : Math.floor(Number(endLine) || safeStartLine);
    const safeEndLine = Math.min(totalLines, Math.max(safeStartLine, requestedEndLine));
    const limitedEndLine = Math.min(safeEndLine, safeStartLine + safeMaxLines - 1);
    const isTruncated = safeEndLine > limitedEndLine || limitedEndLine < totalLines;

    if (safeStartLine > totalLines) {
        throw new Error(`开始行超过文件总行数: startLine=${safeStartLine}, totalLines=${totalLines}`);
    }

    const body = lines
        .slice(safeStartLine - 1, limitedEndLine)
        .map((str, index) => `${safeStartLine + index} | ${str}`)
        .join('\n');

    return [
        `文件: ${filePath}`,
        `总行数: ${totalLines}`,
        `当前返回: 第 ${safeStartLine}-${limitedEndLine} 行`,
        '替换时 oldContent 只填写行号右侧的原始代码，不要包含行号和分隔符。',
        isTruncated ? `内容已截断。如需继续查看，请再次调用 read_file_with_line_numbers，并传入 startLine=${limitedEndLine + 1}。` : '内容未截断。',
        '',
        body
    ].join('\n');
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
