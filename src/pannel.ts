import * as vscode from 'vscode';
import path from "path";
import fs from "fs";
import { runAgent } from './agent';
export class SoulBleachPanel implements vscode.WebviewViewProvider {
    private currentAbortController: AbortController | undefined;

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
                     await runAgent(message.text, (chunk) => {
                        // console.log(chunk,'---chunk');
                        //把结果推回webview
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
        });
    }

    private getHtml(webview: vscode.Webview): string {
        // const htmlPath = path.join(this.context.extensionPath, 'media', 'index.html');
        // return fs.readFileSync(htmlPath, 'utf-8');
        const htmlPath = path.join(this.context.extensionPath, 'media', 'index.html');
        const html = fs.readFileSync(htmlPath, 'utf-8');
        // console.log('html内容长度:', html.length);
        // console.log('html前100字符:', html.substring(0, 100));
        return html;

    }


}
