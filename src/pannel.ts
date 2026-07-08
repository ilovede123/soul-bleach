import * as vscode from 'vscode';
import path from "path";
import fs from "fs";
import { AgentSession } from './agent';
export class SoulBleachPanel implements vscode.WebviewViewProvider {
    private currentAbortController: AbortController | undefined;
    private readonly session = new AgentSession();

    constructor(private readonly context: vscode.ExtensionContext) { }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);


        webviewView.webview.onDidReceiveMessage(async message => {
            if (message.command === 'user-input') {
                if (this.currentAbortController) {
                    return;
                }

                this.currentAbortController = new AbortController();
                webviewView.webview.postMessage({ command: 'stream-start' });
                try {
                    await this.session.run(message.text, (chunk) => {
                        webviewView.webview.postMessage({ command: 'stream-chunk', text: chunk });
                    }, this.currentAbortController.signal);
                } catch (e: any) {
                    if (e?.name !== 'AbortError') {
                        console.error('Soul Bleach error:', e);
                        webviewView.webview.postMessage({
                            command: 'stream-chunk',
                            text: `出错了: ${e?.message ?? String(e)}`
                        });
                    }
                } finally {
                    this.currentAbortController = undefined;
                    webviewView.webview.postMessage({ command: 'stream-end' });
                }
            }

            if (message.command === 'stop-generation') {
                this.currentAbortController?.abort();
            }

            if (message.command === 'clear-history') {
                this.session.clear();
            }
        });
    }

    private getHtml(webview: vscode.Webview): string {
        const htmlPath = path.join(this.context.extensionPath, 'media', 'index.html');
        return fs.readFileSync(htmlPath, 'utf-8');
    }
}
