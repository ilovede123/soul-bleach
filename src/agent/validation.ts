/**
 * author:dengwei date:2026-07-18
 * 确定性验证流水线。根据项目脚本选择命令，不依赖模型决定是否验证。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runCommandDetailed } from './command';
import { ValidationRecord } from './types';

export type ValidationPipelineResult = {
    passed: boolean;
    records: ValidationRecord[];
    summary: string;
};

export function runValidationPipeline(changedFiles: string[]): ValidationPipelineResult {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || changedFiles.length === 0) {
        return { passed: true, records: [], summary: '没有需要验证的文件修改。' };
    }

    const packagePath = path.join(root, 'package.json');
    if (!fs.existsSync(packagePath)) {
        return { passed: true, records: [], summary: '未发现 package.json，已跳过 Node.js 脚本验证。' };
    }

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const scripts = packageJson?.scripts ?? {};
    const runner = getPackageRunner(root);
    const selectedScripts: string[] = [];

    const primary = ['typecheck', 'compile', 'check', 'build'].find(name => typeof scripts[name] === 'string');
    if (primary) {
        selectedScripts.push(primary);
    }
    if (typeof scripts.lint === 'string') {
        selectedScripts.push('lint');
    }
    if (typeof scripts.test === 'string') {
        selectedScripts.push('test');
    }

    if (selectedScripts.length === 0) {
        return { passed: true, records: [], summary: 'package.json 没有可用的 compile、lint 或 test 脚本。' };
    }

    const records: ValidationRecord[] = [];
    for (const script of selectedScripts.slice(0, 3)) {
        const command = `${runner} ${runner.includes('yarn') ? '' : 'run '}${script}`.replace(/\s+/g, ' ').trim();
        const result = runCommandDetailed(command);
        records.push({
            command,
            passed: result.exitCode === 0,
            summary: result.text.slice(0, 4000)
        });
        if (result.exitCode !== 0) {
            break;
        }
    }

    const passed = records.every(record => record.passed);
    return {
        passed,
        records,
        summary: records.map(record => record.summary).join('\n\n')
    };
}

function getPackageRunner(root: string): string {
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) {
        return 'corepack pnpm';
    }
    if (fs.existsSync(path.join(root, 'yarn.lock'))) {
        return 'yarn';
    }
    return 'npm';
}
