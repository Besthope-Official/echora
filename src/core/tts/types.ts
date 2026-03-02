import type * as vscode from 'vscode';

export type LogFn = (message: string) => void;

export interface SpeechSynthesizerBackend extends vscode.Disposable {
	speak(text: string, signal?: AbortSignal): Promise<void>;
	stop(): void;
}
