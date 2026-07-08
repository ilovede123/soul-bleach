/**
 * author:dengwei date:2026-07-08
 * 对话上下文压缩逻辑。
 * 当历史消息过长时，把较早的消息整理成摘要，保留最近交互，减少后续请求的上下文体积。
 */
const CONTEXT_SUMMARY_MARKER = '[Soul Bleach Context Summary]';
const MAX_CONTEXT_MESSAGES = 42;
const RECENT_CONTEXT_MESSAGES = 24;
const MAX_SUMMARY_LENGTH = 6000;
const MAX_MESSAGE_SNIPPET_LENGTH = 700;

export function compactMessages(messages: any[]): any[] {
    if (messages.length <= MAX_CONTEXT_MESSAGES) {
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
            role: 'system',
            content: `${CONTEXT_SUMMARY_MARKER}\n${summary}`
        },
        ...recentMessages
    ];
}

function findRecentStart(messages: any[]): number {
    let start = Math.max(1, messages.length - RECENT_CONTEXT_MESSAGES);

    while (start < messages.length && messages[start]?.role === 'tool') {
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
    return message?.role === 'system' && typeof message.content === 'string' && message.content.startsWith(CONTEXT_SUMMARY_MARKER);
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
    if (message.role === 'user') {
        return `用户需求: ${truncateText(message.content, MAX_MESSAGE_SNIPPET_LENGTH)}`;
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

function truncateText(value: unknown, maxLength: number): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();

    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, maxLength)}...`;
}
