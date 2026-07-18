/**
 * author:dengwei date:2026-07-18
 * 加载仓库中的 AGENTS.md 分层规范，并根据明确引用的文件选择适用范围。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const MAX_GUIDANCE_LENGTH = 16_000;

export function loadAgentGuidance(referencedFiles: string[] = []): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        return '';
    }

    const candidates = new Set<string>([path.join(root, 'AGENTS.md')]);
    for (const referencedFile of referencedFiles) {
        let current = path.dirname(path.resolve(root, referencedFile));
        while (isInsideRoot(root, current)) {
            candidates.add(path.join(current, 'AGENTS.md'));
            if (path.resolve(current) === path.resolve(root)) {
                break;
            }
            current = path.dirname(current);
        }
    }

    const sections: string[] = [];
    for (const file of candidates) {
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            continue;
        }
        const relative = path.relative(root, file).replace(/\\/g, '/') || 'AGENTS.md';
        sections.push(`--- ${relative} ---\n${fs.readFileSync(file, 'utf-8')}`);
    }

    return sections.join('\n\n').slice(0, MAX_GUIDANCE_LENGTH);
}

function isInsideRoot(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
