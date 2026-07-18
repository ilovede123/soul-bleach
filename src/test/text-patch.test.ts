/**
 * author:dengwei date:2026-07-18
 * 上下文补丁引擎测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTextEdits } from '../agent/text-patch';

test('一次补丁可以原子应用多个编辑', () => {
    const source = 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n';
    const result = applyTextEdits(source, [
        { oldText: 'const a = 1;', newText: 'const a = 10;' },
        { oldText: 'console.log(a + b);', newText: 'console.log({ a, b });' }
    ]);
    assert.equal(result.content, 'const a = 10;\nconst b = 2;\nconsole.log({ a, b });\n');
    assert.equal(result.applied, 2);
});

test('任意编辑冲突时不会返回半成品', () => {
    assert.throws(() => applyTextEdits('const a = 1;\n', [
        { oldText: 'const a = 1;', newText: 'const a = 2;' },
        { oldText: 'missing', newText: 'value' }
    ]), /未找到 oldText/);
});

test('重复上下文必须扩大范围或明确 occurrence', () => {
    assert.throws(() => applyTextEdits('x\nx\n', [{ oldText: 'x', newText: 'y' }]), /出现 2 次/);
    assert.equal(
        applyTextEdits('x\nx\n', [{ oldText: 'x', newText: 'y', occurrence: 2 }]).content,
        'x\ny\n'
    );
});
