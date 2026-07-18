/**
 * author:dengwei date:2026-07-08
 * Agent 可调用工具的声明和执行入口。
 * 这里负责把模型看到的工具协议映射到本地文件能力，避免主循环里混入大量工具细节。
 */
import { applyPatch, findFiles, listFiles, readFile, readFileWithLineNumbers, replaceRange, searchText, writeFile } from '../tool';
import { runCommand } from './command';
import { ensureToolPermission } from './permissions';
import { readProcess, startProcess, stopProcess } from './terminal';
import { findWorkspaceSymbols, getProjectMap, getWorkspaceDiagnostics } from './code-intelligence';
import { commitGitChanges, createGitBranch, createGitWorktree, getGitDiff, getGitStatus, openPullRequest, pushGitBranch } from './git-workflow';
import { callMcpTool, getMcpToolDefinitions, isMcpTool } from './mcp';

export const AGENT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'delegate_tasks',
            description: '把互相独立的调查、测试分析或代码审查任务并行委派给最多 3 个只读子智能体。子智能体不能修改文件，只把摘要返回主智能体。简单任务不要调用。',
            parameters: {
                type: 'object',
                properties: {
                    tasks: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 3,
                        items: {
                            type: 'object',
                            properties: {
                                role: { type: 'string', enum: ['explorer', 'tester', 'reviewer'], description: '子智能体角色' },
                                task: { type: 'string', description: '范围明确、可独立完成的子任务' }
                            },
                            required: ['role', 'task']
                        }
                    }
                },
                required: ['tasks']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_file_tasks',
            description: '当用户要求处理整个目录、某类文件或批量文件时，先创建确定性的文件任务清单。任务未全部完成前不能结束。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '工作区内的目标文件或目录路径' },
                    extensions: { type: 'array', items: { type: 'string' }, description: '可选扩展名列表，例如 ["vue", "ts"]' },
                    maxFiles: { type: 'number', description: '最多纳入多少文件，默认 200，最大 500' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_file_task',
            description: '更新批量文件清单中的单个文件状态。文件成功写入会自动完成；无需修改或处理失败时使用此工具明确更新。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '清单中的文件路径' },
                    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'], description: '文件处理状态' },
                    note: { type: 'string', description: '可选说明' }
                },
                required: ['path', 'status']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_plan',
            description: '更新当前任务计划的执行进度。开始执行某个计划步骤前调用，传入该步骤从 1 开始的序号；此前步骤会标记为完成，当前步骤显示为正在执行。',
            parameters: {
                type: 'object',
                properties: {
                    activeStep: {
                        type: 'number',
                        description: '当前准备执行的计划步骤序号，从 1 开始'
                    }
                },
                required: ['activeStep']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_project_map',
            description: '生成工作区受控文件地图。首次理解大型项目时使用，比逐层 list_files 更高效。',
            parameters: {
                type: 'object',
                properties: { maxFiles: { type: 'number', description: '最多索引文件数，默认 300，最大 800' } }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'find_symbol',
            description: '通过 VS Code 语言服务查找类、函数、变量、接口等工作区符号，返回精确文件、行和列。',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '符号名称或名称片段' },
                    maxResults: { type: 'number', description: '最多返回数量，默认 50' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_diagnostics',
            description: '读取 VS Code 语言服务当前报告的语法、类型和静态检查问题。修改后验证时使用。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '可选，只查看一个工作区文件' },
                    maxResults: { type: 'number', description: '最多返回数量，默认 100' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: '读取当前工作区内的小文件全文。代码文件或大文件优先使用 read_file_with_line_numbers 按范围读取，避免一次性占用过多上下文。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path relative to the workspace root.'
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write content to a file inside the current VS Code workspace.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'File path relative to the workspace root.'
                    },
                    content: {
                        type: 'string',
                        description: 'Content to write.'
                    }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List files in a directory inside the current VS Code workspace.',
            parameters: {
                type: 'object',
                properties: {
                    dir: {
                        type: 'string',
                        description: 'Optional directory path relative to the workspace root. Use "." for the root.'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'find_files',
            description: '根据文件名或路径片段在当前工作区中搜索文件路径。当用户只提供文件名、不知道完整路径时使用。',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: '要搜索的文件名或路径片段，例如 "agent.ts"、"request"、"README"'
                    },
                    maxResults: {
                        type: 'number',
                        description: '最多返回多少条结果，默认 30'
                    }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_text',
            description: '按关键字搜索当前工作区或指定文件内容，返回命中的文件、行号和附近少量上下文。用于先定位关键代码，再用 read_file_with_line_numbers 读取片段。',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: '要搜索的代码关键字、函数名、变量名或文本'
                    },
                    path: {
                        type: 'string',
                        description: '可选，限制只在某个工作区文件内搜索'
                    },
                    maxResults: {
                        type: 'number',
                        description: '可选，最多返回多少条命中，默认 30'
                    },
                    contextLines: {
                        type: 'number',
                        description: '可选，每条命中前后返回多少行上下文，默认 2，最大 5'
                    }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file_with_line_numbers',
            description: '按行号范围读取文件内容，返回带行号的片段。默认返回 300 行，批量注释、格式调整等机械任务可一次读取 300-500 行，避免按单个函数反复读取。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '当前工作区内的文件路径'
                    },
                    startLine: {
                        type: 'number',
                        description: '可选，开始行号，从 1 开始。未传时默认从第 1 行开始'
                    },
                    endLine: {
                        type: 'number',
                        description: '可选，结束行号，包含这一行。未传时按 maxLines 截断'
                    },
                    maxLines: {
                        type: 'number',
                        description: '可选，最多返回多少行，默认 300，最大 500。批量修改建议使用 300-500 行'
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'apply_patch',
            description: '使用稳定文本上下文对一个已有文件原子应用多个补丁。批量注释、重命名或重复调整时，应把同一读取批次内已经确定的 5-30 个修改合并到一次调用，不要逐个函数调用。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '当前工作区内的文件路径' },
                    expectedHash: { type: 'string', description: '最近一次 read_file_with_line_numbers 返回的内容哈希，建议传入以检测并发修改' },
                    edits: {
                        type: 'array',
                        description: '按顺序执行的文本补丁，单次最多 30 个；批量任务应尽量填入当前代码区块的全部修改',
                        items: {
                            type: 'object',
                            properties: {
                                oldText: { type: 'string', description: '文件中的原始文本。应包含足够上下文以保证唯一' },
                                newText: { type: 'string', description: '替换后的完整文本；传空字符串表示删除 oldText' },
                                occurrence: { type: 'number', description: 'oldText 重复时指定替换第几处，从 1 开始；优先扩大上下文而不是使用此字段' }
                            },
                            required: ['oldText', 'newText']
                        }
                    }
                },
                required: ['path', 'edits']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'replace_range',
            description: '兼容旧模型的按行替换工具。新任务优先使用 apply_patch，只有模型无法稳定生成上下文补丁时才使用。',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '当前工作区内的文件路径'
                    },
                    startLine: {
                        type: 'number',
                        description: '开始行号，从 1 开始'
                    },
                    endLine: {
                        type: 'number',
                        description: '结束行号，包含这一行'
                    },
                    oldContent: {
                        type: 'string',
                        description: '当前文件中 startLine 到 endLine 的原始内容，必须和最新读取到的内容完全一致'
                    },
                    newContent: {
                        type: 'string',
                        description: '用于替换指定行范围的新内容'
                    }
                },
                required: ['path', 'startLine', 'endLine', 'oldContent', 'newContent']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'git_status',
            description: '查看当前 Git 分支和工作区变更。只读操作。',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'git_diff',
            description: '查看当前 Git 差异。只读操作。',
            parameters: {
                type: 'object',
                properties: { staged: { type: 'boolean', description: '是否只查看已暂存差异' } }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'git_create_branch',
            description: '经用户审批后创建并切换 Git 分支。',
            parameters: {
                type: 'object',
                properties: { branch: { type: 'string', description: '新分支名称' } },
                required: ['branch']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'git_commit',
            description: '经用户审批后提交明确列出的文件。不会默认提交整个工作区。',
            parameters: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: '提交说明' },
                    paths: { type: 'array', items: { type: 'string' }, description: '本次提交包含的工作区相对路径' }
                },
                required: ['message', 'paths']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'git_push',
            description: '经用户审批后推送当前本地分支到 origin。',
            parameters: {
                type: 'object',
                properties: { branch: { type: 'string', description: '要推送的分支名称' } },
                required: ['branch']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'git_create_pr',
            description: '经用户审批后使用 GitHub CLI 创建 Pull Request。',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'PR 标题' },
                    body: { type: 'string', description: 'PR 说明' },
                    base: { type: 'string', description: '目标分支，默认 master' }
                },
                required: ['title', 'body']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'git_create_worktree',
            description: '经用户审批后在系统临时目录创建隔离 Git worktree，适合并行任务。',
            parameters: {
                type: 'object',
                properties: {
                    branch: { type: 'string', description: 'worktree 使用的新分支' },
                    base: { type: 'string', description: '起始提交或分支，默认 HEAD' }
                },
                required: ['branch']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'start_process',
            description: '经用户审批后启动开发服务器后台进程。只允许 dev、start、serve、preview 脚本，返回 sessionId。',
            parameters: {
                type: 'object',
                properties: { command: { type: 'string', description: '例如 corepack pnpm run dev' } },
                required: ['command']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_process',
            description: '读取后台进程自上次读取后的新增输出和当前状态。',
            parameters: {
                type: 'object',
                properties: { sessionId: { type: 'string', description: 'start_process 返回的 sessionId' } },
                required: ['sessionId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'stop_process',
            description: '停止指定后台进程。',
            parameters: {
                type: 'object',
                properties: { sessionId: { type: 'string', description: 'start_process 返回的 sessionId' } },
                required: ['sessionId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: '在当前工作区执行受限验证命令。只允许编译、测试、lint、build 和只读 git 命令，用于修改后的验证或查看差异。',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: '要执行的命令，例如 corepack pnpm run compile、pnpm run lint、git status --short、git diff --stat'
                    }
                },
                required: ['command']
            }
        }
    }
];

export function getAgentTools(task = ''): any[] {
    const text = task.toLowerCase();
    const needsGit = /git|分支|提交|推送|pull request|\bpr\b|worktree|branch|commit|push/i.test(text);
    const needsProcess = /启动|运行.*服务|开发服务器|预览|dev server|start server|serve|preview/i.test(text);
    const needsDelegation = /复杂|多个|全面|整个|全部|审查|重构|架构|排查|分析项目|批量|parallel|review|refactor|architecture/i.test(text);
    const tools = AGENT_TOOLS.filter(tool => {
        const name = tool.function.name;
        if (name.startsWith('git_')) {
            return needsGit;
        }
        if (['start_process', 'read_process', 'stop_process'].includes(name)) {
            return needsProcess;
        }
        if (name === 'delegate_tasks') {
            return needsDelegation;
        }
        return true;
    });
    return [...tools, ...getMcpToolDefinitions()];
}

export async function executeAgentTool(name: string | undefined, args: Record<string, any>): Promise<string> {
    await ensureToolPermission(name, args);
    if (isMcpTool(name)) {
        return callMcpTool(String(name), args);
    }
    if (name === 'read_file') {
        return readFile(args.path);
    }

    if (name === 'read_file_with_line_numbers') {
        return readFileWithLineNumbers(args.path, Number(args.startLine) || 1, args.endLine === undefined ? undefined : Number(args.endLine), Number(args.maxLines) || undefined);
    }

    if (name === 'write_file') {
        return writeFile(args.path, args.content);
    }

    if (name === 'list_files') {
        return listFiles(args.dir || '.');
    }

    if (name === 'find_files') {
        return findFiles(args.query, Number(args.maxResults) || 30);
    }

    if (name === 'search_text') {
        return searchText(args.query, args.path, Number(args.maxResults) || undefined, Number(args.contextLines) || undefined);
    }

    if (name === 'replace_range') {
        return replaceRange(args.path, Number(args.startLine), Number(args.endLine), args.oldContent, args.newContent);
    }

    if (name === 'git_status') {
        return getGitStatus();
    }
    if (name === 'git_diff') {
        return getGitDiff(Boolean(args.staged));
    }
    if (name === 'git_create_branch') {
        return createGitBranch(String(args.branch ?? ''));
    }
    if (name === 'git_commit') {
        return commitGitChanges(String(args.message ?? ''), Array.isArray(args.paths) ? args.paths.map(String) : []);
    }
    if (name === 'git_push') {
        return pushGitBranch(String(args.branch ?? ''));
    }
    if (name === 'git_create_pr') {
        return openPullRequest(String(args.title ?? ''), String(args.body ?? ''), String(args.base ?? 'master'));
    }
    if (name === 'git_create_worktree') {
        return createGitWorktree(String(args.branch ?? ''), String(args.base ?? 'HEAD'));
    }

    if (name === 'get_project_map') {
        return getProjectMap(Number(args.maxFiles) || 300);
    }

    if (name === 'find_symbol') {
        return findWorkspaceSymbols(String(args.query ?? ''), Number(args.maxResults) || 50);
    }

    if (name === 'get_diagnostics') {
        return getWorkspaceDiagnostics(args.path, Number(args.maxResults) || 100);
    }

    if (name === 'apply_patch') {
        return applyPatch(args.path, Array.isArray(args.edits) ? args.edits : [], args.expectedHash);
    }

    if (name === 'run_command') {
        return runCommand(args.command);
    }

    if (name === 'start_process') {
        return startProcess(args.command);
    }

    if (name === 'read_process') {
        return readProcess(args.sessionId);
    }

    if (name === 'stop_process') {
        return stopProcess(args.sessionId);
    }

    return `Unknown tool: ${name ?? 'unknown'}`;
}
