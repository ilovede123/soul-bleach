/**
 * author:dengwei date:2026-07-18
 * 上传文档解析模块。Office、PDF 等二进制格式在本地提取文本，
 * 文本类文件直接按 UTF-8 解码，最终只把受控长度的文本交给模型。
 */
import * as path from 'path';
import { OfficeParser } from 'officeparser';
import { AgentDocumentInput } from './types';

const MAX_DOCUMENT_COUNT = 4;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_LENGTH = 60_000;
const MAX_TOTAL_EXTRACTED_TEXT_LENGTH = 90_000;
const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.json', '.jsonc', '.js', '.jsx', '.ts', '.tsx', '.vue',
    '.html', '.css', '.scss', '.less', '.xml', '.yaml', '.yml', '.toml',
    '.csv', '.log', '.py', '.java', '.go', '.rs', '.php', '.rb', '.sh', '.ps1'
]);
const OFFICE_EXTENSIONS = new Set([
    '.docx', '.pptx', '.xlsx', '.pdf', '.rtf', '.odt', '.odp', '.ods', '.epub'
]);

type UploadedDocumentPayload = {
    name?: unknown;
    dataUrl?: unknown;
};

/** 解析 Webview 上传的文件，并限制数量、大小和最终上下文长度。 */
export async function parseUploadedDocuments(value: unknown, signal?: AbortSignal): Promise<AgentDocumentInput[]> {
    if (!Array.isArray(value)) {
        return [];
    }

    const documents: AgentDocumentInput[] = [];
    let remainingTextLength = MAX_TOTAL_EXTRACTED_TEXT_LENGTH;
    for (const item of value.slice(0, MAX_DOCUMENT_COUNT) as UploadedDocumentPayload[]) {
        throwIfAborted(signal);
        const name = path.basename(String(item?.name ?? 'document'));
        const extension = path.extname(name).toLowerCase();
        const buffer = decodeDataUrl(String(item?.dataUrl ?? ''), name);

        if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
            throw new Error(`文件过大: ${name}，请上传 10MB 以内的文件。`);
        }

        let text: string;
        if (TEXT_EXTENSIONS.has(extension)) {
            text = buffer.toString('utf-8');
        } else if (OFFICE_EXTENSIONS.has(extension)) {
            text = await parseOfficeDocument(buffer, extension, signal);
        } else if (extension === '.doc' || extension === '.ppt' || extension === '.xls') {
            throw new Error(`暂不支持旧版 Office 格式: ${name}，请另存为 docx、pptx 或 xlsx 后上传。`);
        } else {
            throw new Error(`暂不支持该附件格式: ${name}`);
        }

        const normalizedText = text.replace(/\u0000/g, '').trim();
        const allowedLength = Math.min(MAX_EXTRACTED_TEXT_LENGTH, remainingTextLength);
        if (allowedLength <= 0) {
            throw new Error('上传文件提取出的文本总量过大，请减少附件数量或拆分后再发送。');
        }
        const finalText = normalizedText.length > allowedLength
            ? `${normalizedText.slice(0, allowedLength)}\n\n[内容过长，已截断]`
            : normalizedText || '[文件中没有提取到可读文本]';
        remainingTextLength -= Math.min(normalizedText.length, allowedLength);
        documents.push({
            name,
            text: finalText
        });
    }

    return documents;
}

async function parseOfficeDocument(buffer: Buffer, extension: string, signal?: AbortSignal): Promise<string> {
    const fileType = extension.slice(1);
    const ast = await OfficeParser.parseOffice(buffer, {
        fileType,
        abortSignal: signal,
        extractAttachments: false,
        ocr: false,
        ignoreComments: false,
        ignoreNotes: false
    } as any);
    const result = await ast.to('text');
    return String(result.value ?? '');
}

function decodeDataUrl(dataUrl: string, name: string): Buffer {
    const match = dataUrl.match(/^data:[^;,]+;base64,(.+)$/s);
    if (!match) {
        throw new Error(`附件数据无效: ${name}`);
    }
    return Buffer.from(match[1], 'base64');
}

function throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) {
        return;
    }
    const error = new Error('Request aborted.');
    error.name = 'AbortError';
    throw error;
}
