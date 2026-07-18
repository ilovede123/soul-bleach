/**
 * author:dengwei date:2026-07-18
 * 工具调用效率观察器。只负责识别重复读取和连续小补丁，不改变工具执行结果。
 */
export class ToolEfficiencyTracker {
    private readonly readCounts = new Map<string, number>();
    private readonly smallPatchCounts = new Map<string, number>();

    /**
     * 记录一次成功工具调用，并在调用模式明显浪费轮次时返回给模型的调整建议。
     */
    observe(name: string | undefined, args: Record<string, any>): string | undefined {
        if (name === 'read_file_with_line_numbers') {
            return this.observeRangeRead(args);
        }
        if (name === 'apply_patch') {
            this.clearFileReads(String(args.path ?? ''));
            return this.observePatch(args);
        }
        if (name === 'replace_range') {
            this.clearFileReads(String(args.path ?? ''));
            return this.observeSmallWrite(String(args.path ?? ''), 1);
        }
        if (name === 'write_file') {
            this.clearFileReads(String(args.path ?? ''));
        }
        return undefined;
    }

    private observeRangeRead(args: Record<string, any>): string | undefined {
        const signature = [
            String(args.path ?? ''),
            Number(args.startLine) || 1,
            args.endLine === undefined ? '' : Number(args.endLine),
            Number(args.maxLines) || 300
        ].join(':');
        const count = (this.readCounts.get(signature) ?? 0) + 1;
        this.readCounts.set(signature, count);
        if (count < 2) {
            return undefined;
        }
        return '效率提醒：相同文件范围已经重复读取。除非文件刚被修改，否则请使用现有上下文继续工作，或读取下一个 300-500 行批次。';
    }

    private observePatch(args: Record<string, any>): string | undefined {
        const edits = Array.isArray(args.edits) ? args.edits.length : 0;
        const path = String(args.path ?? '');
        if (edits >= 3) {
            this.smallPatchCounts.set(path, 0);
            return undefined;
        }
        return this.observeSmallWrite(path, edits);
    }

    private observeSmallWrite(path: string, editCount: number): string | undefined {
        const count = (this.smallPatchCounts.get(path) ?? 0) + 1;
        this.smallPatchCounts.set(path, count);
        if (count < 3) {
            return undefined;
        }
        this.smallPatchCounts.set(path, 0);
        return `效率提醒：已经连续多次对 ${path || '同一文件'} 提交小补丁。请先读取一个完整代码区块，收集剩余修改，再用一次 apply_patch 提交 5-30 个 edit。当前调用包含 ${editCount} 个 edit。`;
    }

    /** 文件成功写入后，之前的读取结果已经过期，允许重新读取相同范围进行确认。 */
    private clearFileReads(path: string) {
        const prefix = `${path}:`;
        for (const signature of this.readCounts.keys()) {
            if (signature.startsWith(prefix)) {
                this.readCounts.delete(signature);
            }
        }
    }
}
