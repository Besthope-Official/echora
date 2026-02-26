import type * as vscode from 'vscode';

export type TranscriptionResult = {
	text: string;
	isFinal: boolean;
};

export type LogFn = (message: string) => void;

export interface TranscriberBackend extends vscode.Disposable {
	start(): void;
	stop(): void;
	readonly onResult: vscode.Event<TranscriptionResult>;
	readonly onError: vscode.Event<Error>;
	readonly onDidStop: vscode.Event<void>;
}

export interface AudioSource extends vscode.Disposable {
	start(): void;
	stop(): void;
	readonly onData: vscode.Event<Buffer>;
	readonly onError: vscode.Event<Error>;
}
