/** OpenAI-compatible 传输重试策略测试。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRetryDelayMs } from '../providers/openai-compatible';

test('重试延迟使用指数退避并加入可控抖动', () => {
    assert.equal(calculateRetryDelayMs(1, undefined, 0), 500);
    assert.equal(calculateRetryDelayMs(2, undefined, 0.5), 1125);
});

test('Retry-After 秒数优先于较短的本地退避', () => {
    assert.equal(calculateRetryDelayMs(1, '3', 0), 3000);
});
