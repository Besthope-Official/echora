import * as vscode from 'vscode';

const SHARED_OUTPUT_CHANNEL_NAME = 'Echora';

let sharedOutputChannel: vscode.OutputChannel | undefined;

export function showSharedOutputChannel(preserveFocus = true): void {
	getSharedOutputChannel().show(preserveFocus);
}

export function logWithScope(scope: string, message: string): void {
	getSharedOutputChannel().appendLine(`[${new Date().toLocaleTimeString()}] [${scope}] ${message}`);
}

export function disposeSharedOutputChannel(): void {
	if (!sharedOutputChannel) {
		return;
	}
	sharedOutputChannel.dispose();
	sharedOutputChannel = undefined;
}

function getSharedOutputChannel(): vscode.OutputChannel {
	if (!sharedOutputChannel) {
		sharedOutputChannel = vscode.window.createOutputChannel(SHARED_OUTPUT_CHANNEL_NAME);
	}
	return sharedOutputChannel;
}
