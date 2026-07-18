/**
 * author:dengwei date:2026-07-18
 * 子智能体初始上下文构造，保持为纯函数以便测试上下文隔离。
 */
import { SubagentRole } from './types';

export type SubagentTaskInput = { role: SubagentRole; task: string };

export function createSubagentMessages(parentTask: string, task: SubagentTaskInput): any[] {
    const rolePrompt: Record<SubagentRole, string> = {
        explorer: '定位相关文件、符号、调用关系和风险点。只调查，不修改文件。',
        tester: '分析验证策略并运行允许的只读验证命令。不要修改文件。',
        reviewer: '检查需求、现有实现、潜在回归和测试缺口。只报告有证据的问题。'
    };
    return [
        {
            role: 'system',
            content: `你是主智能体派出的 ${task.role} 子智能体。${rolePrompt[task.role]} 使用工具获取事实。最终按“结论、证据（文件与行号）、风险、未覆盖范围”四部分返回简洁中文摘要。工具报错时先修正参数或改用其他只读工具，不要直接放弃。你不能写文件、启动进程或执行 Git 写操作。`
        },
        { role: 'user', content: `主任务:\n${parentTask}\n\n你的独立子任务:\n${task.task}` }
    ];
}
