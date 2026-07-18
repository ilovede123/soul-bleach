/**
 * author:dengwei date:2026-07-18
 * VS Code 侧边栏通信层，负责聊天、图片附件、文件引用和任务进度消息。
 */
import * as vscode from 'vscode';
import path from "path";
import fs from "fs";
import { AgentImageInput, AgentSession } from './agent';
import { AgentSessionSnapshot } from './agent/types';
import { parseUploadedDocuments } from './agent/attachments';
import { getLastFileChangeSet, suggestFiles, undoLastFileChangeSet } from './tool';

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_DATA_URL_LENGTH = 8 * 1024 * 1024;
const SESSION_STATE_KEY = 'soul-bleach.sessionMessages';

export class SoulBleachPanel implements vscode.WebviewViewProvider {
    private currentAbortController: AbortController | undefined;
    private readonly session: AgentSession;
    private webview: vscode.Webview | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.session = new AgentSession(
            context.workspaceState.get<AgentSessionSnapshot | any[]>(SESSION_STATE_KEY),
            snapshot => {
                this.webview?.postMessage({ command: 'run-state-update', state: snapshot.runState });
                return context.workspaceState.update(SESSION_STATE_KEY, snapshot);
            }
        );
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.webview = webviewView.webview;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);


        webviewView.webview.onDidReceiveMessage(async message => {
            if (message.command === 'webview-ready') {
                this.publishRunState(webviewView.webview);
                return;
            }

            if (message.command === 'resume-run') {
                await this.resumeRun(webviewView);
                return;
            }

            if (message.command === 'discard-run') {
                this.session.clear();
                await this.persistSession();
                this.publishRunState(webviewView.webview);
                webviewView.webview.postMessage({ command: 'todo-update', items: [] });
                webviewView.webview.postMessage({ command: 'file-task-update', items: [] });
                return;
            }
            if (message.command === 'undo-last-change') {
                try {
                    const result = undoLastFileChangeSet();
                    this.session.clear();
                    await this.persistSession();
                    vscode.window.showInformationMessage(result);
                    webviewView.webview.postMessage({ command: 'todo-update', items: [] });
                    webviewView.webview.postMessage({ command: 'file-task-update', items: [] });
                } catch (error: any) {
                    vscode.window.showErrorMessage(error?.message ?? String(error));
                }
                return;
            }

            if (message.command === 'show-last-diff') {
                await showLastAgentDiff();
                return;
            }

            if (message.command === 'show-warning') {
                vscode.window.showWarningMessage(String(message.text ?? '输入内容无效'));
                return;
            }

            if (message.command === 'search-files') {
                try {
                    const items = suggestFiles(String(message.query ?? ''), 30);
                    webviewView.webview.postMessage({ command: 'file-suggestions', items });
                } catch (error: any) {
                    webviewView.webview.postMessage({
                        command: 'file-suggestions',
                        items: [],
                        error: error?.message ?? String(error)
                    });
                }
                return;
            }

            if (message.command === 'user-input') {
                if (this.currentAbortController) {
                    return;
                }

                this.currentAbortController = new AbortController();
                webviewView.webview.postMessage({ command: 'todo-update', items: [] });
                webviewView.webview.postMessage({ command: 'stream-start' });
                try {
                    const images = sanitizeImages(message.images);
                    const documents = await parseUploadedDocuments(message.documents, this.currentAbortController.signal);
                    const referencedFiles = sanitizeReferencedFiles(message.referencedFiles);
                    await this.session.run(message.text, (chunk) => {
                        webviewView.webview.postMessage({ command: 'stream-chunk', text: chunk });
                    }, this.currentAbortController.signal, (items) => {
                        webviewView.webview.postMessage({ command: 'todo-update', items });
                    }, { images, documents, referencedFiles }, (items) => {
                        webviewView.webview.postMessage({ command: 'file-task-update', items });
                    });
                } catch (e: any) {
                    if (e?.name === 'AgentPauseError') {
                        webviewView.webview.postMessage({ command: 'stream-chunk', text: e.message });
                    } else if (e?.name !== 'AbortError') {
                        console.error('Soul Bleach error:', e);
                        webviewView.webview.postMessage({
                            command: 'stream-chunk',
                            text: `出错了: ${e?.message ?? String(e)}`
                        });
                    }
                } finally {
                    await this.persistSession();
                    this.currentAbortController = undefined;
                    webviewView.webview.postMessage({ command: 'stream-end' });
                }
            }

            if (message.command === 'stop-generation') {
                this.currentAbortController?.abort();
            }

            if (message.command === 'clear-history') {
                this.session.clear();
                await this.persistSession();
                webviewView.webview.postMessage({ command: 'todo-update', items: [] });
            }
        });
    }

    private getHtml(webview: vscode.Webview): string {
        const htmlPath = path.join(this.context.extensionPath, 'media', 'index.html');
        return fs.readFileSync(htmlPath, 'utf-8');
    }

    private async persistSession() {
        await this.context.workspaceState.update(SESSION_STATE_KEY, this.session.exportState());
    }

    private publishRunState(webview: vscode.Webview) {
        const runState = this.session.getRunState();
        webview.postMessage({ command: 'run-state-update', state: runState });
        if (runState) {
            webview.postMessage({ command: 'todo-update', items: runState.plan });
            webview.postMessage({ command: 'file-task-update', items: runState.fileTasks });
        }
    }

    private async resumeRun(webviewView: vscode.WebviewView) {
        if (this.currentAbortController) {
            return;
        }
        this.currentAbortController = new AbortController();
        webviewView.webview.postMessage({ command: 'stream-start' });
        try {
            await this.session.resume((chunk) => {
                webviewView.webview.postMessage({ command: 'stream-chunk', text: chunk });
            }, this.currentAbortController.signal, (items) => {
                webviewView.webview.postMessage({ command: 'todo-update', items });
            }, (items) => {
                webviewView.webview.postMessage({ command: 'file-task-update', items });
            });
        } catch (error: any) {
            if (error?.name === 'AgentPauseError') {
                webviewView.webview.postMessage({ command: 'stream-chunk', text: error.message });
            } else if (error?.name !== 'AbortError') {
                webviewView.webview.postMessage({ command: 'stream-chunk', text: `出错了: ${error?.message ?? String(error)}` });
            }
        } finally {
            await this.persistSession();
            this.currentAbortController = undefined;
            this.publishRunState(webviewView.webview);
            webviewView.webview.postMessage({ command: 'stream-end' });
        }
    }
}

/** 选择最近一次修改的文件，并使用 VS Code 原生 Diff 编辑器对比修改前后内容。 */
async function showLastAgentDiff() {
    const changes = getLastFileChangeSet();
    if (changes.length === 0) {
        vscode.window.showInformationMessage('最近一次任务没有文件修改。');
        return;
    }

    const selectedPath = changes.length === 1
        ? changes[0].path
        : await vscode.window.showQuickPick(changes.map(item => item.path), { placeHolder: '选择要查看的 Agent 修改' });
    if (!selectedPath) {
        return;
    }

    const change = changes.find(item => item.path === selectedPath)!;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        throw new Error('没有打开的工作区');
    }

    const currentUri = vscode.Uri.file(path.join(root, change.path));
    const beforeDocument = await vscode.workspace.openTextDocument({ content: change.before ?? '' });
    await vscode.commands.executeCommand(
        'vscode.diff',
        beforeDocument.uri,
        currentUri,
        `${change.path}（修改前 ↔ 当前）`
    );
}

/** 对 Webview 传入的图片进行数量、类型和大小校验。 */
function sanitizeImages(value: unknown): AgentImageInput[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.slice(0, MAX_IMAGE_COUNT).map((item: any) => {
        const name = String(item?.name ?? 'image');
        const dataUrl = String(item?.dataUrl ?? '');
        if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
            throw new Error(`图片格式无效: ${name}`);
        }
        if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
            throw new Error(`图片过大: ${name}，请选择 6MB 以内的图片。`);
        }
        return { name, dataUrl };
    });
}

/** 清理 @ 文件列表，限制数量并去除重复路径。 */
function sanitizeReferencedFiles(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return [...new Set(value.map(item => String(item ?? '').trim()).filter(Boolean))].slice(0, 20);
}
