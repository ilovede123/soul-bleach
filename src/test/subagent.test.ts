/**
 * author:dengwei date:2026-07-18
 * 子智能体上下文隔离测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubagentMessages } from '../agent/subagent-context';

test('子智能体只接收主任务和自己的子任务', () => {
    const messages = createSubagentMessages('实现登录功能', { role: 'explorer', task: '定位认证入口' });
    assert.equal(messages.length, 2);
    assert.match(messages[0].content, /不能写文件/);
    assert.match(messages[1].content, /实现登录功能/);
    assert.match(messages[1].content, /定位认证入口/);
    assert.doesNotMatch(JSON.stringify(messages), /tool_calls/);
});
