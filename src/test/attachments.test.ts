/**
 * author:dengwei date:2026-07-18
 * 上传附件解析测试，重点确认 UTF-8 文本和输入校验行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUploadedDocuments } from '../agent/attachments';

test('文本附件按 UTF-8 解析', async () => {
    const content = '标题\n这是中文内容';
    const dataUrl = `data:text/plain;base64,${Buffer.from(content, 'utf-8').toString('base64')}`;
    const documents = await parseUploadedDocuments([{ name: '说明.txt', dataUrl }]);

    assert.deepEqual(documents, [{ name: '说明.txt', text: content }]);
});

test('不支持的附件类型会返回清晰错误', async () => {
    const dataUrl = `data:application/octet-stream;base64,${Buffer.from('data').toString('base64')}`;
    await assert.rejects(
        parseUploadedDocuments([{ name: 'demo.bin', dataUrl }]),
        /暂不支持该附件格式/
    );
});
