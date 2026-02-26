import * as vscode from 'vscode';
import type { MicrophoneSessionCoordinator } from '../core/microphoneSessionCoordinator';

export function registerPipelineCommands(coordinator: MicrophoneSessionCoordinator): vscode.Disposable {
	const startDisposable = vscode.commands.registerCommand('echora.startVoicePipeline', async () => {
		await coordinator.startPipeline();
	});
	const stopDisposable = vscode.commands.registerCommand('echora.stopVoicePipeline', async () => {
		await coordinator.stopPipeline('Stopped by user.');
	});

	return vscode.Disposable.from(startDisposable, stopDisposable);
}
