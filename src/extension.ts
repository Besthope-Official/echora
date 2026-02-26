import * as vscode from 'vscode';
import { registerDictationCommands } from './commands/dictation';
import { DictationService } from './core/stt/dictationService';

export function activate(context: vscode.ExtensionContext): void {
	const dictationService = new DictationService();
	const commandDisposables = registerDictationCommands(dictationService);

	context.subscriptions.push(dictationService, commandDisposables);
}

export function deactivate(): void {
	// cleanup is handled by context subscriptions
}
