import * as vscode from 'vscode';
import { formatError } from '../../utils/errors';
import { logWithScope, showSharedOutputChannel } from '../../utils/outputLogger';
import type { LogFn, TranscriberBackend } from './types';

export class DictationService implements vscode.Disposable {
	private backend: TranscriberBackend | undefined;
	private listeners: vscode.Disposable[] = [];
	private timeout: NodeJS.Timeout | undefined;
	private sessionActive = false;
	private activeSessionId = 0;

	constructor(private readonly createBackend: (log: LogFn) => Promise<TranscriberBackend>) {}

	public async start(): Promise<void> {
		if (this.sessionActive) {
			this.log('A voice input session is already running.');
			return;
		}
		showSharedOutputChannel(true);
		const sessionId = ++this.activeSessionId;
		this.sessionActive = true;

		this.log(
			`Starting voice input session. remoteName=${vscode.env.remoteName ?? 'none'}, uiKind=${
				vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'web'
			}.`
		);
		this.log(`Host runtime: platform=${process.platform}, arch=${process.arch}, node=${process.version}.`);

		let backend: TranscriberBackend;
		try {
			backend = await this.createBackend((message) => {
				if (!this.isCurrentSession(sessionId)) {
					return;
				}
				this.log(message);
			});
		} catch (error) {
			if (!this.isCurrentSession(sessionId)) {
				return;
			}
			const message = formatError(error);
			this.log(`Runtime initialization failed: ${message}`);
			vscode.window.showErrorMessage(`Echora Voice Input: ${message}`);
			this.endSession('Runtime initialization failed.');
			return;
		}
		if (!this.isCurrentSession(sessionId)) {
			this.disposeBackendInstance(backend);
			return;
		}

		const durationMs = vscode.workspace
			.getConfiguration('echora')
			.get<number>('stt.sessionDurationMs', 20_000);

		this.listeners.push(
			backend.onResult((r) => {
				if (!this.isCurrentSession(sessionId)) {
					return;
				}
				this.log(`${r.isFinal ? 'Final' : 'Partial'}: ${r.text}`);
			}),
			backend.onError((e) => {
				if (!this.isCurrentSession(sessionId)) {
					return;
				}
				this.log(`Error: ${e.message}`);
				void this.stop('Stopped due to error.');
			}),
			backend.onDidStop(() => {
				if (!this.isCurrentSession(sessionId)) {
					return;
				}
				void this.stop('Backend stopped.');
			})
		);

		if (durationMs > 0) {
			this.timeout = setTimeout(() => {
				if (!this.isCurrentSession(sessionId)) {
					return;
				}
				void this.stop(`Auto-stopped after ${durationMs / 1000}s.`);
			}, durationMs);
		}

		this.backend = backend;

		try {
			if (!this.isCurrentSession(sessionId)) {
				this.disposeBackendInstance(backend);
				return;
			}
			backend.start();
			if (!this.isCurrentSession(sessionId)) {
				return;
			}
			this.log('Transcriber started. Speak now and check callback status logs below.');
		} catch (error) {
			if (!this.isCurrentSession(sessionId)) {
				this.disposeBackendInstance(backend);
				return;
			}
			const message = formatError(error);
			this.log(`Failed to start transcriber: ${message}`);
			vscode.window.showErrorMessage(`Echora Voice Input: start failed (${message})`);
			this.endSession('Stopped because start() threw an error.');
		}
	}

	public async stop(reason: string): Promise<void> {
		if (!this.sessionActive) {
			return;
		}
		this.endSession(reason);
	}

	public dispose(): void {
		this.endSession('Stopped because extension was deactivated.');
	}

	private endSession(reason: string): void {
		const hadActiveSession =
			this.sessionActive || this.backend !== undefined || this.listeners.length > 0 || this.timeout !== undefined;
		if (!hadActiveSession) {
			return;
		}
		this.activeSessionId += 1;
		this.sessionActive = false;
		clearTimeout(this.timeout);
		this.timeout = undefined;
		this.log(reason);
		this.shutdownBackend();
	}

	private isCurrentSession(sessionId: number): boolean {
		return this.activeSessionId === sessionId;
	}

	private shutdownBackend(): void {
		const backend = this.backend;
		if (backend) {
			try {
				backend.stop();
			} catch (error) {
				this.log(`backend.stop() failed: ${formatError(error)}`);
			}
			try {
				backend.dispose();
			} catch (error) {
				this.log(`backend.dispose() failed: ${formatError(error)}`);
			}
		}

		for (const listener of this.listeners) {
			listener.dispose();
		}
		this.listeners = [];
		this.backend = undefined;
	}

	private disposeBackendInstance(backend: TranscriberBackend): void {
		try {
			backend.stop();
		} catch {
			// noop, stale session cleanup
		}
		try {
			backend.dispose();
		} catch {
			// noop, stale session cleanup
		}
	}

	private log(message: string): void {
		logWithScope('DictationService', message);
	}
}
