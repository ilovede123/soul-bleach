/** 长任务自动续跑预算测试。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getRunBudgetEvent,
    MAX_AGENT_ITERATIONS_PER_RUN,
    ProgressWatchdog
} from '../agent/run-budget';

test('80 轮检查点会自动续跑，只有总上限前才警告', () => {
    assert.equal(getRunBudgetEvent(0), undefined);
    assert.equal(getRunBudgetEvent(79), undefined);
    assert.equal(getRunBudgetEvent(80), 'checkpoint');
    assert.equal(getRunBudgetEvent(160), 'checkpoint');
    assert.equal(getRunBudgetEvent(240), 'checkpoint');
    assert.equal(getRunBudgetEvent(MAX_AGENT_ITERATIONS_PER_RUN - 20), 'warning');
});

test('重复进展键不会掩盖连续无进展状态', () => {
    const watchdog = new ProgressWatchdog(3);
    assert.equal(watchdog.observe(1, 'read_file:a.ts'), true);
    assert.equal(watchdog.observe(2, 'read_file:a.ts'), false);
    assert.equal(watchdog.isStalled(3), false);
    assert.equal(watchdog.isStalled(4), true);
    assert.equal(watchdog.getIdleIterations(4), 3);
});

test('新的有效进展会重新开始停滞计数', () => {
    const watchdog = new ProgressWatchdog(3);
    watchdog.observe(1, 'read_file:a.ts');
    watchdog.observe(3, 'read_file:b.ts');
    assert.equal(watchdog.isStalled(5), false);
    assert.equal(watchdog.isStalled(6), true);
});
