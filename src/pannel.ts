import * as vscode from 'vscode';
import path from "path";
import fs from "fs";
export class SoulAgentPanel implements vscode.WebviewViewProvider {

    constructor(private readonly context: vscode.ExtensionContext) { }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);
    }

    private getHtml(webview: vscode.Webview): string {
        const htmlPath = path.join(this.context.extensionPath, 'media', 'index.html');
        return fs.readFileSync(htmlPath, 'utf-8');
    }
}