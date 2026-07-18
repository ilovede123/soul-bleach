/**
 * author:dengwei date:2026-07-18
 * 灵境独立设置页。普通模型配置写入 VS Code Settings，密钥只写入 SecretStorage。
 */
import * as vscode from 'vscode';
import { clearApiKey, hasApiKey, setApiKey, type ModelPreset, type ModelProvider } from './providers/config';
import { completion } from './request';

const PROVIDERS: Array<{ value: ModelProvider; label: string }> = [
    { value: 'qwen', label: '阿里云百炼 Qwen' },
    { value: 'zhipu-open', label: '智谱开放平台' },
    { value: 'zhipu-coding', label: '智谱 Coding Plan' },
    { value: 'zai', label: 'Z.AI 国际站' },
    { value: 'custom', label: '自定义 OpenAI-compatible' }
];

const MODELS: Array<{ value: ModelPreset; label: string }> = [
    { value: 'provider-default', label: '跟随服务商' },
    { value: 'qwen3.7-plus', label: 'Qwen3.7 Plus' },
    { value: 'qwen3.7-max', label: 'Qwen3.7 Max' },
    { value: 'qwen-plus', label: 'Qwen Plus' },
    { value: 'glm-5.2', label: 'GLM-5.2' },
    { value: 'glm-5.2-1m', label: 'GLM-5.2 1M' },
    { value: 'glm-5.1', label: 'GLM-5.1' },
    { value: 'glm-5', label: 'GLM-5' },
    { value: 'glm-4.7', label: 'GLM-4.7' },
    { value: 'glm-4.7-flash', label: 'GLM-4.7 Flash' },
    { value: 'custom', label: '自定义模型' }
];

export class SoulBleachSettingsPanel {
    private static current: SoulBleachSettingsPanel | undefined;

    static createOrShow(context: vscode.ExtensionContext) {
        if (SoulBleachSettingsPanel.current) {
            SoulBleachSettingsPanel.current.panel.reveal(vscode.ViewColumn.One);
            void SoulBleachSettingsPanel.current.render();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'soulBleachSettings',
            '灵境设置',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        SoulBleachSettingsPanel.current = new SoulBleachSettingsPanel(panel, context);
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext
    ) {
        this.panel.onDidDispose(() => {
            SoulBleachSettingsPanel.current = undefined;
        }, undefined, context.subscriptions);

        this.panel.webview.onDidReceiveMessage(message => {
            void this.handleMessage(message).catch(error => {
                vscode.window.showErrorMessage(error?.message ?? String(error));
            });
        }, undefined, context.subscriptions);
        void this.render();
    }

    private async handleMessage(message: any) {
        if (message.command === 'save') {
            await this.saveSettings(message.values ?? {});
            vscode.window.showInformationMessage('灵境设置已保存。');
            await this.render();
            return;
        }

        if (message.command === 'delete-key') {
            await clearApiKey();
            vscode.window.showInformationMessage('灵境 API Key 已删除。');
            await this.render();
            return;
        }

        if (message.command === 'test') {
            try {
                await this.saveSettings(message.values ?? {});
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '正在测试灵境模型连接...'
                }, () => completion([
                    { role: 'system', content: '这是连接测试，只回复 OK。' },
                    { role: 'user', content: '测试连接' }
                ], []));
                vscode.window.showInformationMessage('模型连接成功。');
                void this.panel.webview.postMessage({ command: 'test-result', ok: true, text: '连接成功' });
            } catch (error: any) {
                const text = error?.message ?? String(error);
                vscode.window.showErrorMessage(`模型连接失败: ${text}`);
                void this.panel.webview.postMessage({ command: 'test-result', ok: false, text });
            }
        }
    }

    private async saveSettings(values: Record<string, unknown>) {
        const provider = String(values.provider ?? 'qwen') as ModelProvider;
        const modelPreset = String(values.modelPreset ?? 'provider-default') as ModelPreset;
        if (!PROVIDERS.some(item => item.value === provider)) {
            throw new Error('不支持的模型服务商。');
        }
        if (!MODELS.some(item => item.value === modelPreset)) {
            throw new Error('不支持的模型预设。');
        }

        const baseUrl = String(values.baseUrl ?? '').trim();
        if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
            throw new Error('接口地址必须以 http:// 或 https:// 开头。');
        }

        const config = vscode.workspace.getConfiguration('soul-bleach');
        await config.update('provider', provider, vscode.ConfigurationTarget.Global);
        await config.update('modelPreset', modelPreset, vscode.ConfigurationTarget.Global);
        await config.update('baseUrl', baseUrl || undefined, vscode.ConfigurationTarget.Global);
        await config.update('model', String(values.model ?? '').trim() || undefined, vscode.ConfigurationTarget.Global);

        const apiKey = String(values.apiKey ?? '').trim();
        if (apiKey) {
            await setApiKey(apiKey);
        }
    }

    private async render() {
        const config = vscode.workspace.getConfiguration('soul-bleach');
        const rawBaseUrl = config.get<string>('baseUrl', '').trim();
        const invalidBaseUrl = Boolean(rawBaseUrl && !/^https?:\/\//i.test(rawBaseUrl));
        const state = {
            provider: config.get<ModelProvider>('provider', 'qwen'),
            modelPreset: config.get<ModelPreset>('modelPreset', 'provider-default'),
            baseUrl: invalidBaseUrl ? '' : rawBaseUrl,
            model: config.get<string>('model', ''),
            apiKeyConfigured: await hasApiKey(),
            invalidBaseUrl
        };
        this.panel.webview.html = getSettingsHtml(state);
    }
}

function getSettingsHtml(state: {
    provider: ModelProvider;
    modelPreset: ModelPreset;
    baseUrl: string;
    model: string;
    apiKeyConfigured: boolean;
    invalidBaseUrl: boolean;
}): string {
    const nonce = Math.random().toString(36).slice(2);
    const providerOptions = PROVIDERS.map(item => option(item.value, item.label, state.provider)).join('');
    const modelOptions = MODELS.map(item => option(item.value, item.label, state.modelPreset)).join('');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>灵境设置</title>
    <style nonce="${nonce}">
        body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px var(--vscode-font-family); }
        main { width: min(680px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 48px; }
        h1 { margin: 0 0 24px; font-size: 22px; font-weight: 600; }
        section { padding: 20px 0; border-top: 1px solid var(--vscode-panel-border); }
        section:first-of-type { border-top: 0; }
        h2 { margin: 0 0 16px; font-size: 14px; font-weight: 600; }
        .field { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; align-items: center; margin: 12px 0; }
        label { color: var(--vscode-foreground); }
        input, select { box-sizing: border-box; width: 100%; min-height: 30px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 5px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
        input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
        .secret { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 14px; background: var(--vscode-sideBar-background); }
        .status { display: inline-flex; align-items: center; gap: 7px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
        .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-testing-iconPassed); }
        .status-dot.empty { background: var(--vscode-descriptionForeground); }
        .hint, #result { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.5; }
        .warning { margin: 0 0 16px; padding: 9px 10px; border-left: 3px solid var(--vscode-editorWarning-foreground); background: var(--vscode-inputValidation-warningBackground); }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
        button { min-height: 30px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; padding: 5px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
        button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        #result { margin-top: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
        #result.error { color: var(--vscode-errorForeground); }
        @media (max-width: 520px) { .field { grid-template-columns: 1fr; gap: 5px; } main { width: calc(100% - 24px); padding-top: 18px; } }
    </style>
</head>
<body>
<main>
    <h1>灵境设置</h1>
    ${state.invalidBaseUrl ? '<div class="warning">检测到原接口地址不是有效 URL，已隐藏该内容。保存设置后会清除错误值。</div>' : ''}
    <section>
        <h2>模型服务</h2>
        <div class="field"><label for="provider">服务商</label><select id="provider">${providerOptions}</select></div>
        <div class="field"><label for="modelPreset">模型预设</label><select id="modelPreset">${modelOptions}</select></div>
        <div class="field"><label for="baseUrl">自定义接口地址</label><input id="baseUrl" value="${escapeHtml(state.baseUrl)}" placeholder="留空时使用服务商默认地址"></div>
        <div class="field"><label for="model">自定义模型名称</label><input id="model" value="${escapeHtml(state.model)}" placeholder="留空时使用模型预设"></div>
    </section>
    <section>
        <h2>API Key</h2>
        <div class="secret">
            <div class="status"><span class="status-dot ${state.apiKeyConfigured ? '' : 'empty'}"></span>${state.apiKeyConfigured ? '已安全配置' : '未配置'}</div>
            <input id="apiKey" type="password" autocomplete="new-password" placeholder="留空表示保留当前密钥，输入新值会直接覆盖">
            <p class="hint">密钥仅保存到 VS Code SecretStorage，设置页面不会读取或显示已保存的原文。</p>
        </div>
    </section>
    <div class="actions">
        <button id="save">保存设置</button>
        <button id="test" class="secondary">测试连接</button>
        <button id="delete" class="secondary">删除密钥</button>
    </div>
    <div id="result"></div>
</main>
<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const value = id => document.getElementById(id).value;
    const collectValues = () => ({ provider: value('provider'), modelPreset: value('modelPreset'), baseUrl: value('baseUrl'), model: value('model'), apiKey: value('apiKey') });
    document.getElementById('save').addEventListener('click', () => vscode.postMessage({
        command: 'save',
        values: collectValues()
    }));
    document.getElementById('test').addEventListener('click', () => {
        const result = document.getElementById('result');
        result.className = '';
        result.textContent = '正在测试连接...';
        vscode.postMessage({ command: 'test', values: collectValues() });
    });
    document.getElementById('delete').addEventListener('click', () => vscode.postMessage({ command: 'delete-key' }));
    window.addEventListener('message', event => {
        if (event.data.command !== 'test-result') return;
        const result = document.getElementById('result');
        result.className = event.data.ok ? '' : 'error';
        result.textContent = event.data.text;
    });
</script>
</body>
</html>`;
}

function option(value: string, label: string, selected: string): string {
    return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}
