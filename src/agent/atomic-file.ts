/**
 * author:dengwei date:2026-07-18
 * 不依赖 VS Code 的原子文件写入工具，便于独立测试和复用。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';

/** 使用同目录临时文件完整写入后再替换目标，避免目标文件只写入一半。 */
export function atomicWriteFile(fullPath: string, content: string) {
    const temporaryPath = path.join(path.dirname(fullPath), `.${path.basename(fullPath)}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;

    try {
        descriptor = fs.openSync(temporaryPath, 'wx');
        fs.writeFileSync(descriptor, content, 'utf-8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.renameSync(temporaryPath, fullPath);
    } catch (error) {
        if (descriptor !== undefined) {
            fs.closeSync(descriptor);
        }
        if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
        }
        throw error;
    }
}

export function hashText(value: string): string {
    return createHash('sha256').update(value, 'utf-8').digest('hex');
}
