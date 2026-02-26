import * as vscode from 'vscode';
import { formatError } from '../../utils/errors';
import type { LogFn, TranscriberBackend } from './types';

export class DictationService implements vscode.Disposable {
	private outputChannel: vscode.OutputChannel | undefined;
	private backend: TranscriberBackend | undefined;
	private listeners: vscode.Disposable[] = [];
	private timeout: NodeJS.Timeout | undefined;
	private stopping = false;

	constructor(private readonly createBackend: (log: LogFn) => Promise<TranscriberBackend>) {}

	public async start(): Promise<void> {
		const output = this.getOutputChannel();
		output.show(true);
		if (this.backend && !this.stopping) {
			this.log('A voice input session is already running.');
			return;
		}

		this.log(
			`Starting voice input session. remoteName=${vscode.env.remoteName ?? 'none'}, uiKind=${
				vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'web'
			}.`
		);
		this.log(`Host runtime: platform=${process.platform}, arch=${process.arch}, node=${process.version}.`);

		let backend: TranscriberBackend;
		try {
			backend = await this.createBackend((message) => {
				this.log(message);
			});
		} catch (error) {
			const message = formatError(error);
			this.log(`Runtime initialization failed: ${message}`);
			vscode.window.showErrorMessage(`Echora Voice Input: ${message}`);
			return;
		}

		const durationMs = vscode.workspace
			.getConfiguration('echora')
			.get<number>('stt.sessionDurationMs', 20_000);

		this.listeners.push(
			backend.onResult((r) => {
				this.log(`${r.isFinal ? 'Final' : 'Partial'}: ${r.text}`);
			}),
			backend.onError((e) => {
				this.log(`Error: ${e.message}`);
				void this.stop('Stopped due to error.');
			}),
			backend.onDidStop(() => {
				void this.stop('Backend stopped.');
			})
		);

		if (durationMs > 0) {
			this.timeout = setTimeout(() => {
				void this.stop(`Auto-stopped after ${durationMs / 1000}s.`);
			}, durationMs);
		}

		this.backend = backend;

		try {
			backend.start();
			this.log('Transcriber started. Speak now and check callback status logs below.');
		} catch (error) {
			const message = formatError(error);
			this.log(`Failed to start transcriber: ${message}`);
			await this.stop('Stopped because start() threw an error.');
			vscode.window.showErrorMessage(`Echora Voice Input: start failed (${message})`);
		}
	}

	public async stop(reason: string): Promise<void> {
		if (!this.backend || this.stopping) {
			return;
		}
		this.stopping = true;
		clearTimeout(this.timeout);
		this.timeout = undefined;
		this.log(reason);

		try {
			this.backend.stop();
		} catch (error) {
			this.log(`backend.stop() failed: ${formatError(error)}`);
		}
		try {
			this.backend.dispose();
		} catch (error) {
			this.log(`backend.dispose() failed: ${formatError(error)}`);
		}

		for (const listener of this.listeners) {
			listener.dispose();
		}
		this.listeners = [];
		this.backend = undefined;
		this.stopping = false;
	}

	public dispose(): void {
		void this.stop('Stopped because extension was deactivated.');
		if (this.outputChannel) {
			this.outputChannel.dispose();
			this.outputChannel = undefined;
		}
	}

	private getOutputChannel(): vscode.OutputChannel {
		if (!this.outputChannel) {
			this.outputChannel = vscode.window.createOutputChannel('Echora Voice Input');
		}
		return this.outputChannel;
	}

	private log(message: string): void {
		this.getOutputChannel().appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
	}
}
