/**
 * author:dengwei date:2026-07-18
 * MCP 客户端管理器。动态发现外部服务器工具并映射为 OpenAI-compatible 工具定义。
 */
import * as vscode from 'vscode';
import { logDiagnostic } from '../diagnostics';

type McpServerConfig = {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
};

type ConnectedServer = {
    name: string;
    client: any;
    transport: any;
};

type ToolRoute = { server: ConnectedServer; originalName: string };

const servers = new Map<string, ConnectedServer>();
const toolRoutes = new Map<string, ToolRoute>();
let toolDefinitions: any[] = [];

export async function initializeMcp(context: vscode.ExtensionContext) {
    await reloadMcpServers();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('soul-bleach.mcpServers')) {
            void reloadMcpServers();
        }
    }));
}

export async function reloadMcpServers() {
    await disposeMcp();
    const configs = vscode.workspace.getConfiguration('soul-bleach').get<McpServerConfig[]>('mcpServers', []);
    if (configs.length === 0) {
        return;
    }
    const [{ Client }, { StdioClientTransport, getDefaultEnvironment }] = await Promise.all([
        import('@modelcontextprotocol/sdk/client'),
        import('@modelcontextprotocol/sdk/client/stdio.js')
    ]);
    const configuredNames = new Set<string>();
    for (const config of configs) {
        if (config.enabled === false || !config.name || !config.command) {
            continue;
        }
        if (configuredNames.has(config.name)) {
            logDiagnostic(`MCP 配置已跳过，服务器名称重复: ${config.name}`);
            continue;
        }
        configuredNames.add(config.name);
        let transport: any;
        try {
            const client = new Client({ name: 'soul-bleach', version: '1.1.0' });
            transport = new StdioClientTransport({
                command: config.command,
                args: config.args ?? [],
                env: config.env ? { ...getDefaultEnvironment(), ...resolveEnvironment(config.env) } : undefined,
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                stderr: 'pipe'
            });
            await withTimeout(client.connect(transport), 10_000, `MCP 连接超时: ${config.name}`);
            const connected: ConnectedServer = { name: config.name, client, transport };
            servers.set(config.name, connected);
            const listed = await client.listTools();
            for (const tool of listed.tools) {
                const exposedName = createExposedName(config.name, tool.name);
                toolRoutes.set(exposedName, { server: connected, originalName: tool.name });
                toolDefinitions.push({
                    type: 'function',
                    function: {
                        name: exposedName,
                        description: `[MCP:${config.name}] ${tool.description ?? tool.name}`,
                        parameters: tool.inputSchema
                    }
                });
            }
            logDiagnostic(`MCP 已连接 server=${config.name} tools=${listed.tools.length}`);
        } catch (error: any) {
            await transport?.close().catch(() => undefined);
            logDiagnostic(`MCP 连接失败 server=${config.name} error=${error?.message ?? String(error)}`);
        }
    }
}

export function getMcpToolDefinitions(): any[] {
    return toolDefinitions.map(tool => ({ ...tool, function: { ...tool.function } }));
}

export function isMcpTool(name: string | undefined): boolean {
    return toolRoutes.has(String(name));
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
    const route = toolRoutes.get(name);
    if (!route) {
        throw new Error(`MCP 工具不存在或服务器尚未连接: ${name}`);
    }
    const result: any = await route.server.client.callTool({ name: route.originalName, arguments: args });
    const blocks = Array.isArray(result.content) ? result.content.map(formatContentBlock) : [];
    if (result.structuredContent) {
        blocks.push(JSON.stringify(result.structuredContent, null, 2));
    }
    const text = blocks.filter(Boolean).join('\n');
    if (result.isError) {
        throw new Error(text || `MCP 工具执行失败: ${name}`);
    }
    return text || '(MCP 工具执行成功，没有文本输出)';
}

export async function disposeMcp() {
    const closing = [...servers.values()].map(async server => {
        try {
            await server.client.close();
        } catch {
            await server.transport.close().catch(() => undefined);
        }
    });
    await Promise.all(closing);
    servers.clear();
    toolRoutes.clear();
    toolDefinitions = [];
}

function createExposedName(server: string, tool: string): string {
    const normalize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    return `mcp__${normalize(server)}__${normalize(tool)}`.slice(0, 100);
}

function resolveEnvironment(values?: Record<string, string>): Record<string, string> | undefined {
    if (!values) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(values).map(([key, value]) => {
        const match = String(value).match(/^\$\{env:([^}]+)\}$/);
        return [key, match ? process.env[match[1]] ?? '' : String(value)];
    }));
}

function formatContentBlock(block: any): string {
    if (block?.type === 'text') {
        return String(block.text ?? '');
    }
    if (block?.type === 'resource') {
        return block.resource?.text ?? `[资源: ${block.resource?.uri ?? 'unknown'}]`;
    }
    if (block?.type === 'resource_link') {
        return `[资源链接: ${block.name ?? ''} ${block.uri ?? ''}]`;
    }
    if (block?.type === 'image' || block?.type === 'audio') {
        return `[${block.type}: ${block.mimeType ?? 'unknown'}，二进制内容未写入对话]`;
    }
    return JSON.stringify(block);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
            })
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}
