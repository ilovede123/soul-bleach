import * as vscode from 'vscode';
import { runAgent } from './agent';
import { listFiles } from './tool';
import { SoulBleachPanel } from './pannel';

export function activate(context: vscode.ExtensionContext) {
	console.log('Soul Bleach is active.');

	const disposable = vscode.commands.registerCommand('soul-bleach.helloWorld', () => {
		vscode.window.showInformationMessage('灵境已启动');
	});

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

	const testCommand = vscode.commands.registerCommand('soul-bleach.test', async () => {
		try {
			const result = listFiles('.');
			vscode.window.showInformationMessage(`${result},---result`);
			console.log(result, '-----result');
		} catch (e: any) {
			vscode.window.showErrorMessage(e.message);
		}
	});

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'soulBleachView',
			new SoulBleachPanel(context)
		)
	);
	context.subscriptions.push(disposable);
	context.subscriptions.push(agentCommand);
	context.subscriptions.push(testCommand);
}

export function deactivate() { }
