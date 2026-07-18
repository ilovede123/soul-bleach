/**
 * 长任务执行预算。
 * 80 轮只是内部检查点；运行时会自动跨越多个检查点，只有达到总上限或长期无进展才暂停。
 */
export const AGENT_ITERATIONS_PER_CHECKPOINT = 80;
export const MAX_AUTOMATIC_CHECKPOINTS = 4;
export const MAX_AGENT_ITERATIONS_PER_RUN = AGENT_ITERATIONS_PER_CHECKPOINT * MAX_AUTOMATIC_CHECKPOINTS;
export const RUN_BUDGET_WARNING_AT = 20;
export const MAX_NO_PROGRESS_ITERATIONS = 32;
export const RUN_BUDGET_WARNING_MARKER = '[Soul Bleach Run Budget Warning]';
export const AUTO_CONTINUE_MARKER = '[Soul Bleach Automatic Continuation]';

export type RunBudgetEvent = 'checkpoint' | 'warning' | undefined;

export function getRunBudgetEvent(localIteration: number): RunBudgetEvent {
    if (localIteration > 0 && localIteration % AGENT_ITERATIONS_PER_CHECKPOINT === 0) {
        return 'checkpoint';
    }
    if (localIteration === MAX_AGENT_ITERATIONS_PER_RUN - RUN_BUDGET_WARNING_AT) {
        return 'warning';
    }
    return undefined;
}

/** 用唯一进展键识别重复循环；相同读取或相同工具参数不会反复刷新进展时间。 */
export class ProgressWatchdog {
    private readonly seenProgress = new Set<string>();
    private lastProgressIteration = 0;

    constructor(private readonly maxIdleIterations = MAX_NO_PROGRESS_ITERATIONS) {}

    observe(iteration: number, key: string): boolean {
        if (!key || this.seenProgress.has(key)) {
            return false;
        }
        this.seenProgress.add(key);
        this.lastProgressIteration = iteration;
        return true;
    }

    isStalled(iteration: number): boolean {
        return iteration - this.lastProgressIteration >= this.maxIdleIterations;
    }

    getIdleIterations(iteration: number): number {
        return Math.max(0, iteration - this.lastProgressIteration);
    }
}
