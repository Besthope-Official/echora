import * as vscode from 'vscode';
import type { MicrophoneSessionCoordinator } from '../core/microphoneSessionCoordinator';

export function registerDictationCommands(coordinator: MicrophoneSessionCoordinator): vscode.Disposable {
	const startDisposable = vscode.commands.registerCommand('echora.startDictation', async () => {
		await coordinator.startDictation();
	});
	const stopDisposable = vscode.commands.registerCommand('echora.stopDictation', async () => {
		await coordinator.stopDictation('Stopped by user.');
	});

	return vscode.Disposable.from(startDisposable, stopDisposable);
}
