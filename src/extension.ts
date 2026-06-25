// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { runAgent } from './agent';
import { listFiles } from './tool';
import { SoulBleachPanel } from './pannel';
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "soul-bleach" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('soul-bleach.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from soul-bleach!');
	});

	const outputChannel = vscode.window.createOutputChannel('Soul Bleach');
	//运行命令
	const agentCommand = vscode.commands.registerCommand('soul-bleach.run', async () => {
		const task = await vscode.window.showInputBox({
			prompt: "输入你想让我帮你做什么?",
			placeHolder: '例如:给index.ts加上注释'
		});

		if (!task) { return; } //用户取消了

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

// This method is called when your extension is deactivated
export function deactivate() { }
