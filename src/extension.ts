import * as vscode from 'vscode';
import { registerDictationCommands } from './commands/dictation';
import { DictationService } from './core/stt/dictationService';
import { createNodeSpeechBackend } from './core/stt/nodeSpeechBackend';

export function activate(context: vscode.ExtensionContext): void {
	const dictationService = new DictationService((log) => createNodeSpeechBackend(log));
	const commandDisposables = registerDictationCommands(dictationService);

	context.subscriptions.push(dictationService, commandDisposables);
}

export function deactivate(): void {
	// cleanup is handled by context subscriptions
}
