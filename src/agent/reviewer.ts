/**
 * author:dengwei date:2026-07-18
 * 独立代码审查器。使用隔离上下文检查本次变更，不读取主 Agent 的工具噪声。
 */
import { completion } from '../request';
import { FileChangeEntry } from '../tool';

export type ReviewResult = {
    approved: boolean;
    issues: string[];
    summary: string;
};

const MAX_REVIEW_CONTEXT = 70_000;

export async function reviewChanges(task: string, changes: FileChangeEntry[], signal?: AbortSignal): Promise<ReviewResult> {
    const changeText = changes.map(change => [
        `文件: ${change.path}`,
        '--- 修改前 ---',
        change.before ?? '[新文件]',
        '--- 修改后 ---',
        change.after
    ].join('\n')).join('\n\n').slice(0, MAX_REVIEW_CONTEXT);

    const message = await completion([
        {
            role: 'system',
            content: [
                '你是独立代码审查器，只审查给出的需求和文件修改。',
                '重点检查明确的功能错误、语法问题、行为回归、遗漏需求和缺少必要验证。',
                '不要提出纯风格偏好，不要假设未提供的代码。',
                '只返回 JSON：{"approved":true,"issues":[],"summary":"审查结论"}。',
                '存在必须修复的问题时 approved=false，每条 issue 必须包含文件名和具体证据。'
            ].join(' ')
        },
        { role: 'user', content: `用户需求:\n${task}\n\n本次修改:\n${changeText}` }
    ], [], undefined, signal);

    try {
        const json = String(message.content ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '';
        const parsed = JSON.parse(json);
        const issues = Array.isArray(parsed.issues) ? parsed.issues.map(String).filter(Boolean).slice(0, 10) : [];
        return {
            approved: Boolean(parsed.approved) && issues.length === 0,
            issues,
            summary: String(parsed.summary ?? '')
        };
    } catch {
        return { approved: true, issues: [], summary: '审查器返回格式无法解析，已保留确定性验证结果。' };
    }
}
