/**
 * author:dengwei date:2026-07-18
 * 原子写入与内容校验测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { atomicWriteFile, hashText } from '../agent/atomic-file';

test('原子写入可以创建并替换 UTF-8 文件', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-bleach-'));
    const filePath = path.join(directory, 'demo.txt');
    try {
        atomicWriteFile(filePath, '第一版');
        atomicWriteFile(filePath, '第二版\n中文内容');
        assert.equal(fs.readFileSync(filePath, 'utf-8'), '第二版\n中文内容');
        assert.deepEqual(fs.readdirSync(directory), ['demo.txt']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('内容哈希对相同文本稳定，对不同文本敏感', () => {
    assert.equal(hashText('same'), hashText('same'));
    assert.notEqual(hashText('before'), hashText('after'));
});
