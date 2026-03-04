import * as vscode from 'vscode';
import type { MicrophoneSessionCoordinator } from '../core/microphoneSessionCoordinator';
import type { VoicePipeline } from '../core/pipeline';

export function registerPipelineCommands(
	coordinator: MicrophoneSessionCoordinator,
	pipeline: VoicePipeline
): vscode.Disposable {
	const startDisposable = vscode.commands.registerCommand('echora.startVoicePipeline', async () => {
		await coordinator.startPipeline();
	});
	const stopDisposable = vscode.commands.registerCommand('echora.stopVoicePipeline', async () => {
		await coordinator.stopPipeline('Stopped by user.');
	});
	const toggleDisposable = vscode.commands.registerCommand('echora.toggleVoicePipeline', async () => {
		if (pipeline.getState() === 'idle') {
			await coordinator.startPipeline();
			return;
		}
		await coordinator.stopPipeline('Stopped by user.');
	});

	return vscode.Disposable.from(startDisposable, stopDisposable, toggleDisposable);
}
