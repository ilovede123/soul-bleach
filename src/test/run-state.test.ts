/**
 * author:dengwei date:2026-07-18
 * 任务运行状态恢复测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunState, restoreRunState } from '../agent/run-state';

test('运行中的任务恢复后变为暂停', () => {
    const state = createRunState('修改项目', [{ id: '1', title: '读取文件', status: 'in_progress' }]);
    state.iteration = 7;
    const restored = restoreRunState(state);
    assert.equal(restored.status, 'paused');
    assert.equal(restored.iteration, 7);
    assert.match(restored.lastError ?? '', /已暂停/);
});

test('恢复状态不会与原状态共享可变数组', () => {
    const state = createRunState('测试', [{ id: '1', title: '步骤', status: 'pending' }]);
    const restored = restoreRunState(state);
    restored.plan[0].title = '已改变';
    restored.changedFiles.push('src/a.ts');
    assert.equal(state.plan[0].title, '步骤');
    assert.deepEqual(state.changedFiles, []);
});
