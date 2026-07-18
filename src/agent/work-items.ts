/**
 * author:dengwei date:2026-07-18
 * 批量文件任务跟踪器。程序持有真实目标文件清单，避免模型处理一部分后误报完成。
 */
import { collectTaskFiles } from '../tool';
import { FileProgressHandler, FileTaskItem, FileTaskStatus } from './types';

export class FileTaskTracker {
    private items: FileTaskItem[];

    constructor(private readonly onProgress?: FileProgressHandler, initialItems: FileTaskItem[] = []) {
        this.items = initialItems.map(item => ({ ...item }));
        if (this.items.length > 0) {
            this.publish();
        }
    }

    get snapshot(): FileTaskItem[] {
        return this.items.map(item => ({ ...item }));
    }

    get hasTasks(): boolean {
        return this.items.length > 0;
    }

    get hasOpenTasks(): boolean {
        return this.items.some(item => item.status === 'pending' || item.status === 'in_progress');
    }

    create(targetPath: string, extensions: string[], maxFiles: number): string {
        const paths = collectTaskFiles(targetPath, extensions, maxFiles);
        if (paths.length === 0) {
            throw new Error(`没有在 ${targetPath} 中找到符合条件的文件。`);
        }

        this.items = paths.map(path => ({ path, status: 'pending' }));
        this.publish();
        return [
            `已创建批量文件任务，共 ${paths.length} 个文件。`,
            ...paths.map((path, index) => `${index + 1}. ${path}`),
            '必须处理并更新每个文件的状态，不能在仍有 pending 或 in_progress 项时结束任务。'
        ].join('\n');
    }

    update(path: string, status: FileTaskStatus, note?: string): string {
        if (!['pending', 'in_progress', 'completed', 'failed'].includes(status)) {
            throw new Error(`无效的文件任务状态: ${status}`);
        }
        const normalizedPath = normalizePath(path);
        const item = this.items.find(candidate => normalizePath(candidate.path) === normalizedPath);
        if (!item) {
            throw new Error(`文件不在当前批量任务清单中: ${path}`);
        }

        item.status = status;
        item.note = note;
        this.publish();
        return `文件任务已更新: ${item.path} -> ${status}`;
    }

    observeTool(name: string | undefined, args: Record<string, any>) {
        const path = String(args.path ?? '');
        if (!path || !this.hasTasks) {
            return;
        }
        const item = this.items.find(candidate => normalizePath(candidate.path) === normalizePath(path));
        if (!item) {
            return;
        }

        if ((name === 'read_file' || name === 'read_file_with_line_numbers') && item.status === 'pending') {
            item.status = 'in_progress';
            this.publish();
        }
        if (name === 'apply_patch' || name === 'replace_range' || name === 'write_file') {
            item.status = 'completed';
            this.publish();
        }
    }

    createRemainingMessage(): string {
        const remaining = this.items.filter(item => item.status === 'pending' || item.status === 'in_progress');
        return [
            '[Soul Bleach File Task Check]',
            `批量任务尚未完成，仍有 ${remaining.length} 个文件待处理：`,
            ...remaining.slice(0, 60).map(item => `- [${item.status}] ${item.path}`),
            '请继续逐个读取和处理。完成修改后会自动标记 completed；无需修改的文件请调用 update_file_task 明确标记 completed，无法处理则标记 failed 并说明原因。'
        ].join('\n');
    }

    getSummary(): { total: number; completed: number; failed: number; open: number } {
        return {
            total: this.items.length,
            completed: this.items.filter(item => item.status === 'completed').length,
            failed: this.items.filter(item => item.status === 'failed').length,
            open: this.items.filter(item => item.status === 'pending' || item.status === 'in_progress').length
        };
    }

    private publish() {
        this.onProgress?.(this.items.map(item => ({ ...item })));
    }
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}
