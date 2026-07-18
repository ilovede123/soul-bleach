/**
 * author:dengwei date:2026-07-08
 * 对话上下文压缩逻辑。
 * 当历史消息过长时，把较早的消息整理成摘要，保留最近交互，减少后续请求的上下文体积。
 */
const CONTEXT_SUMMARY_MARKER = '[Soul Bleach Context Summary]';
const MAX_CONTEXT_MESSAGES = 42;
const RECENT_CONTEXT_MESSAGES = 24;
const MAX_CONTEXT_CHARACTERS = 90_000;
const RECENT_CONTEXT_CHARACTERS = 55_000;
const MAX_SUMMARY_LENGTH = 6000;
const MAX_MESSAGE_SNIPPET_LENGTH = 700;

export function compactMessages(messages: any[]): any[] {
    if (messages.length <= MAX_CONTEXT_MESSAGES && estimateMessagesSize(messages) <= MAX_CONTEXT_CHARACTERS) {
        return messages;
    }

    const systemMessage = messages[0];
    const recentStart = findRecentStart(messages);
    const previousSummary = extractExistingSummary(messages);
    const oldMessages = messages
        .slice(1, recentStart)
        .filter(message => !isContextSummary(message));
    const summary = buildContextSummary(previousSummary, oldMessages);
    const recentMessages = messages.slice(recentStart);

    return [
        systemMessage,
        {
            // 摘要作为新的 user 上下文，保证压缩后第一个非 system 消息仍然是 user
            role: 'user',
            content: `${CONTEXT_SUMMARY_MARKER}\n${summary}`
        },
        ...recentMessages
    ];
}

function findRecentStart(messages: any[]): number {
    let start = messages.length;
    let characters = 0;

    while (start > 1 && messages.length - start < RECENT_CONTEXT_MESSAGES) {
        const nextSize = estimateMessageSize(messages[start - 1]);
        if (characters > 0 && characters + nextSize > RECENT_CONTEXT_CHARACTERS) {
            break;
        }
        characters += nextSize;
        start--;
    }

    // 摘要后从一条 user 消息重新开始，避免留下没有对应调用的 tool 消息。
    while (start < messages.length && messages[start]?.role !== 'user') {
        start++;
    }

    return start;
}

function extractExistingSummary(messages: any[]): string {
    const summaryMessage = messages.find(isContextSummary);
    if (!summaryMessage?.content) {
        return '';
    }

    return String(summaryMessage.content).replace(CONTEXT_SUMMARY_MARKER, '').trim();
}

function isContextSummary(message: any): boolean {
    // 同时识别旧版 system 摘要，兼容扩展更新前已经存在于内存中的会话
    return (message?.role === 'user' || message?.role === 'system')
        && typeof message.content === 'string'
        && message.content.startsWith(CONTEXT_SUMMARY_MARKER);
}

function buildContextSummary(previousSummary: string, messages: any[]): string {
    const parts: string[] = [];

    if (previousSummary) {
        parts.push(previousSummary);
    }

    for (const message of messages) {
        const summaryLine = summarizeMessage(message);
        if (summaryLine) {
            parts.push(summaryLine);
        }
    }

    return truncateText(parts.join('\n'), MAX_SUMMARY_LENGTH);
}

function summarizeMessage(message: any): string {
    // 执行计划属于长任务的关键状态，压缩时必须保留，避免模型忘记尚未完成的步骤
    if (message.role === 'system' && String(message.content).startsWith('[Soul Bleach Execution Plan]')) {
        return `执行计划: ${truncateText(message.content, MAX_MESSAGE_SNIPPET_LENGTH)}`;
    }

    if (message.role === 'user') {
        return `用户需求: ${truncateText(extractMessageContent(message.content), MAX_MESSAGE_SNIPPET_LENGTH)}`;
    }

    if (message.role === 'assistant') {
        const lines: string[] = [];

        if (message.content) {
            lines.push(`助手回复: ${truncateText(message.content, MAX_MESSAGE_SNIPPET_LENGTH)}`);
        }

        if (message.tool_calls?.length) {
            for (const toolCall of message.tool_calls) {
                const name = toolCall.function?.name ?? 'unknown';
                const args = truncateText(toolCall.function?.arguments ?? '', 400);
                lines.push(`工具调用: ${name}(${args})`);
            }
        }

        return lines.join('\n');
    }

    if (message.role === 'tool') {
        return `工具结果: ${truncateText(message.content, MAX_MESSAGE_SNIPPET_LENGTH)}`;
    }

    return '';
}

/**
 * 从纯文本或多模态消息中提取可写入摘要的文本。
 * 图片本体不进入摘要，只记录图片数量，避免 Base64 数据占满上下文。
 */
function extractMessageContent(content: unknown): string {
    if (!Array.isArray(content)) {
        return String(content ?? '');
    }

    const text = content
        .filter(item => item?.type === 'text')
        .map(item => String(item.text ?? ''))
        .join('\n');
    const imageCount = content.filter(item => item?.type === 'image_url').length;
    return imageCount > 0 ? `${text}\n用户上传图片: ${imageCount} 张` : text;
}

function truncateText(value: unknown, maxLength: number): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();

    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, maxLength)}...`;
}

function estimateMessagesSize(messages: any[]): number {
    return messages.reduce((total, message) => total + estimateMessageSize(message), 0);
}

function estimateMessageSize(message: any): number {
    try {
        return JSON.stringify(message).length;
    } catch {
        return String(message?.content ?? '').length;
    }
}
