/**
 * author:dengwei date:2026-07-18
 * 扩展激活入口，负责注册侧边栏、命令以及模型密钥管理。
 */
import * as vscode from 'vscode';
import { runAgent } from './agent';
import { SoulBleachPanel } from './pannel';
import { clearApiKey, initializeModelConfig, setApiKey } from './providers/config';
import { initializeDiagnostics, showDiagnostics } from './diagnostics';
import { completion } from './request';

export async function activate(context: vscode.ExtensionContext) {
	console.log('Soul Bleach is active.');
	initializeDiagnostics(context);
	await initializeModelConfig(context.secrets);

	const outputChannel = vscode.window.createOutputChannel('Soul Bleach');
	const agentCommand = vscode.commands.registerCommand('soul-bleach.run', async () => {
		const task = await vscode.window.showInputBox({
			prompt: "输入你想让我帮你做什么?",
			placeHolder: '例如:给index.ts加上注释'
		});

		if (!task) { return; }

		vscode.window.showInformationMessage(`好的,agent运行中`);

		try {
			const result = await runAgent(task);
			outputChannel.clear();
			outputChannel.appendLine(result);
			outputChannel.show();
		} catch (e: any) {
			vscode.window.showErrorMessage(e.message);
		}
	});

	const setApiKeyCommand = vscode.commands.registerCommand('soul-bleach.setApiKey', async () => {
		const value = await vscode.window.showInputBox({
			prompt: '输入当前模型服务商的 API Key',
			placeHolder: '内网无鉴权服务可以不设置',
			password: true,
			ignoreFocusOut: true
		});
		if (value === undefined) {
			return;
		}
		if (!value.trim()) {
			await clearApiKey();
			vscode.window.showInformationMessage('已清除灵境 API Key。');
			return;
		}
		await setApiKey(value);
		vscode.window.showInformationMessage('灵境 API Key 已安全保存。');
	});

	const clearApiKeyCommand = vscode.commands.registerCommand('soul-bleach.clearApiKey', async () => {
		await clearApiKey();
		vscode.window.showInformationMessage('已清除灵境 API Key。');
	});

	const testConnectionCommand = vscode.commands.registerCommand('soul-bleach.testConnection', async () => {
		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: '正在测试灵境模型连接...'
			}, () => completion([
				{ role: 'system', content: '这是连接测试，只回复 OK。' },
				{ role: 'user', content: '测试连接' }
			], []));
			vscode.window.showInformationMessage('模型连接成功。');
		} catch (error: any) {
			vscode.window.showErrorMessage(`模型连接失败: ${error?.message ?? String(error)}`);
			showDiagnostics();
		}
	});

	const showDiagnosticsCommand = vscode.commands.registerCommand('soul-bleach.showDiagnostics', showDiagnostics);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'soulBleachView',
			new SoulBleachPanel(context)
		)
	);
	context.subscriptions.push(agentCommand);
	context.subscriptions.push(setApiKeyCommand);
	context.subscriptions.push(clearApiKeyCommand);
	context.subscriptions.push(testConnectionCommand);
	context.subscriptions.push(showDiagnosticsCommand);
}

export function deactivate() { }
