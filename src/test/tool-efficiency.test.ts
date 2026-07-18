/**
 * author:dengwei date:2026-07-18
 * 工具调用效率观察器测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolEfficiencyTracker } from '../agent/tool-efficiency';

test('重复读取相同范围时给出效率提醒', () => {
    const tracker = new ToolEfficiencyTracker();
    const args = { path: 'src/demo.ts', startLine: 1, maxLines: 300 };
    assert.equal(tracker.observe('read_file_with_line_numbers', args), undefined);
    assert.match(tracker.observe('read_file_with_line_numbers', args) ?? '', /重复读取/);
});

test('连续小补丁达到阈值时要求合并编辑', () => {
    const tracker = new ToolEfficiencyTracker();
    const args = { path: 'src/demo.ts', edits: [{ oldText: 'a', newText: 'b' }] };
    assert.equal(tracker.observe('apply_patch', args), undefined);
    assert.equal(tracker.observe('apply_patch', args), undefined);
    assert.match(tracker.observe('apply_patch', args) ?? '', /5-30 个 edit/);
});

test('批量补丁会重置同一文件的小补丁计数', () => {
    const tracker = new ToolEfficiencyTracker();
    const small = { path: 'src/demo.ts', edits: [{ oldText: 'a', newText: 'b' }] };
    tracker.observe('apply_patch', small);
    tracker.observe('apply_patch', small);
    tracker.observe('apply_patch', { path: 'src/demo.ts', edits: [1, 2, 3] });
    assert.equal(tracker.observe('apply_patch', small), undefined);
});

test('文件写入后允许重新读取相同范围进行确认', () => {
    const tracker = new ToolEfficiencyTracker();
    const readArgs = { path: 'src/demo.ts', startLine: 1, maxLines: 300 };
    tracker.observe('read_file_with_line_numbers', readArgs);
    tracker.observe('apply_patch', {
        path: 'src/demo.ts',
        edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }, { oldText: 'e', newText: 'f' }]
    });
    assert.equal(tracker.observe('read_file_with_line_numbers', readArgs), undefined);
});
