/**
 * 统一解析模型生成的工具参数，并对常见的不完整 JSON 做保守修复。
 * 主智能体和子智能体必须走同一条解析路径，避免相同模型输出在两个运行器中表现不一致。
 */
export function parseToolArguments(name: string | undefined, rawArgs: string): Record<string, any> {
    try {
        const parsed = JSON.parse(rawArgs || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('工具参数必须是 JSON 对象。');
        }
        return parsed;
    } catch (error: any) {
        const repairedArgs = repairToolArguments(name, rawArgs);
        if (repairedArgs) {
            return repairedArgs;
        }

        throw new Error([
            '工具参数不是合法 JSON。',
            `工具: ${name ?? 'unknown'}`,
            `参数: ${rawArgs}`,
            `错误: ${error?.message ?? String(error)}`
        ].join('\n'));
    }
}

function repairToolArguments(name: string | undefined, rawArgs: string): Record<string, any> | undefined {
    if (['list_files', 'get_project_map', 'get_diagnostics', 'git_status', 'git_diff'].includes(String(name))) {
        if (name === 'list_files') {
            return { dir: extractStringArgument(rawArgs, 'dir') || '.' };
        }
        return {};
    }

    if (name === 'find_files' || name === 'find_symbol') {
        const query = extractStringArgument(rawArgs, 'query');
        return query ? { query } : undefined;
    }

    if (name === 'search_text') {
        const query = extractStringArgument(rawArgs, 'query');
        const path = extractStringArgument(rawArgs, 'path');
        return query ? { query, ...(path ? { path } : {}) } : undefined;
    }

    if (name === 'run_command') {
        const command = extractStringArgument(rawArgs, 'command');
        return command ? { command } : undefined;
    }

    if (name === 'read_file' || name === 'read_file_with_line_numbers') {
        const path = extractStringArgument(rawArgs, 'path');
        return path ? { path } : undefined;
    }

    return undefined;
}

function extractStringArgument(rawArgs: string, key: string): string | undefined {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"}]*)`);
    return rawArgs.match(pattern)?.[1];
}
