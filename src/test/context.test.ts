/**
 * author:dengwei date:2026-07-18
 * 上下文压缩测试，保证长会话不会破坏消息角色顺序或保存图片 Base64。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compactMessages } from '../agent/context';

test('短会话保持原样', () => {
    const messages = [
        { role: 'system', content: 'system' },
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好' }
    ];
    assert.equal(compactMessages(messages), messages);
});

test('超长会话会生成摘要并从 user 消息继续', () => {
    const messages: any[] = [{ role: 'system', content: 'system' }];
    for (let index = 0; index < 30; index++) {
        messages.push({ role: 'user', content: `需求 ${index} ${'x'.repeat(1800)}` });
        messages.push({ role: 'assistant', content: `回复 ${index}` });
    }

    const compacted = compactMessages(messages);
    assert.equal(compacted[0].role, 'system');
    assert.equal(compacted[1].role, 'user');
    assert.match(compacted[1].content, /Soul Bleach Context Summary/);
    assert.ok(compacted.length < messages.length);
});

test('多模态历史摘要不会保留图片 Base64', () => {
    const messages: any[] = [{ role: 'system', content: 'system' }];
    messages.push({
        role: 'user',
        content: [
            { type: 'text', text: '参考这个界面' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${'a'.repeat(100_000)}` } }
        ]
    });
    for (let index = 0; index < 50; index++) {
        messages.push({ role: index % 2 === 0 ? 'assistant' : 'user', content: `消息 ${index}` });
    }

    const serialized = JSON.stringify(compactMessages(messages));
    assert.doesNotMatch(serialized, /data:image\/png;base64/);
    assert.match(serialized, /用户上传图片: 1 张/);
});
