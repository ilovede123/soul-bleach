/**
 * author:dengwei date:2026-07-18
 * 子智能体上下文隔离测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubagentMessages } from '../agent/subagent-context';
import { runSingleSubagentWithDependencies, runSubagentsWithDependencies } from '../agent/subagent-runtime';

const readOnlyTools = new Set(['read_file']);
const toolDefinitions = [{ type: 'function', function: { name: 'read_file' } }];

test('子智能体只接收主任务和自己的子任务', () => {
    const messages = createSubagentMessages('实现登录功能', { role: 'explorer', task: '定位认证入口' });
    assert.equal(messages.length, 2);
    assert.match(messages[0].content, /不能写文件/);
    assert.match(messages[1].content, /实现登录功能/);
    assert.match(messages[1].content, /定位认证入口/);
    assert.doesNotMatch(JSON.stringify(messages), /tool_calls/);
});

test('子智能体复用参数修复并在工具调用后完成摘要', async () => {
    const responses = [
        {
            role: 'assistant',
            tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"src/agent.ts' } }]
        },
        { role: 'assistant', content: '结论：读取成功' }
    ];
    const paths: string[] = [];
    const summary = await runSingleSubagentWithDependencies(
        '审查项目',
        { role: 'reviewer', task: '检查运行器' },
        toolDefinitions,
        readOnlyTools,
        {
            complete: async () => responses.shift(),
            executeTool: async (_name, args) => {
                paths.push(String(args.path));
                return '文件内容';
            }
        }
    );

    assert.equal(summary, '结论：读取成功');
    assert.deepEqual(paths, ['src/agent.ts']);
});

test('工具失败会反馈给子智能体并允许它自行恢复', async () => {
    let requestCount = 0;
    let observedToolError = false;
    const summary = await runSingleSubagentWithDependencies(
        '审查项目',
        { role: 'explorer', task: '定位入口' },
        toolDefinitions,
        readOnlyTools,
        {
            complete: async messages => {
                requestCount++;
                observedToolError ||= messages.some(message => /Soul Bleach Tool Error/.test(String(message.content ?? '')));
                return requestCount === 1
                    ? { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"missing.ts"}' } }] }
                    : { role: 'assistant', content: '已根据其他证据完成' };
            },
            executeTool: async () => { throw new Error('文件不存在'); }
        }
    );

    assert.equal(summary, '已根据其他证据完成');
    assert.equal(observedToolError, true);
});

test('协调器限制并发并为失败任务重试一次', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const activities: string[][] = [];
    const resultText = await runSubagentsWithDependencies(
        '全面审查项目',
        [
            { role: 'explorer', task: '结构' },
            { role: 'tester', task: '测试' },
            { role: 'reviewer', task: '风险' }
        ],
        toolDefinitions,
        readOnlyTools,
        {
            complete: async () => {
                calls++;
                const callNumber = calls;
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise(resolve => setTimeout(resolve, 5));
                active--;
                if (callNumber === 1) {
                    throw new Error('瞬时失败');
                }
                return { role: 'assistant', content: '完成' };
            },
            executeTool: async () => '',
            wait: async () => undefined
        },
        undefined,
        items => activities.push(items.map(item => item.status)),
        { maxConcurrency: 2, maxAttempts: 2 }
    );
    const result = JSON.parse(resultText);

    assert.equal(maxActive, 2);
    assert.equal(result.status, 'completed');
    assert.equal(result.results.length, 3);
    assert.ok(result.results.some((item: any) => item.attempts === 2));
    assert.ok(activities.length >= 4);
});
