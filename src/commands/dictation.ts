import * as vscode from 'vscode';
import { DictationService } from '../core/stt/dictationService';

export function registerDictationCommands(service: DictationService): vscode.Disposable {
	const startDisposable = vscode.commands.registerCommand('echora.startDictation', async () => {
		await service.start();
	});
	const stopDisposable = vscode.commands.registerCommand('echora.stopDictation', async () => {
		await service.stop('Stopped by user.');
	});

	return vscode.Disposable.from(startDisposable, stopDisposable);
}
