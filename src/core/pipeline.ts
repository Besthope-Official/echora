import * as vscode from 'vscode';
import type { TextConsumer } from './consumer/types';
import type { LogFn, TranscriberBackend, TranscriptionResult } from './stt/types';
import type { PipelineState, PipelineStateChange } from '../types/pipeline';
import { formatError } from '../utils/errors';
import { logWithScope, showSharedOutputChannel } from '../utils/outputLogger';

// Single-utterance pipeline: one final STT result -> one consumer dispatch -> return to idle.
export class VoicePipeline implements vscode.Disposable {
	private readonly _onStateChanged = new vscode.EventEmitter<PipelineStateChange>();
	public readonly onStateChanged = this._onStateChanged.event;

	private backend: TranscriberBackend | undefined;
	private backendListeners: vscode.Disposable[] = [];
	private state: PipelineState = 'idle';
	private processingFinalResult = false;
	private activeSessionId = 0;
	private processingTask: Promise<void> | undefined;
	private processingAbortController: AbortController | undefined;

	constructor(
		private readonly createBackend: (log: LogFn) => Promise<TranscriberBackend>,
		private readonly textConsumer: TextConsumer
	) {}

	public getState(): PipelineState {
		return this.state;
	}

	public async startListening(): Promise<void> {
		if (this.state !== 'idle') {
			this.log(`startListening ignored because current state is '${this.state}'.`);
			return;
		}
		await this.waitForProcessingToFinish();
		showSharedOutputChannel(true);
		const sessionId = ++this.activeSessionId;
		this.processingFinalResult = false;
		this.processingAbortController = undefined;
		this.transitionTo('listening', 'Starting transcriber');

		this.log(
			`Starting voice pipeline. remoteName=${vscode.env.remoteName ?? 'none'}, uiKind=${
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
			vscode.window.showErrorMessage(`Echora Voice Pipeline: ${message}`);
			this.endSession('Runtime initialization failed.');
			return;
		}
		if (!this.isCurrentSession(sessionId)) {
			this.disposeBackendInstance(backend);
			return;
		}

		this.backend = backend;
		this.bindBackend(sessionId, backend);

		try {
			backend.start();
			if (!this.isCurrentSession(sessionId)) {
				return;
			}
			this.log('Transcriber started. Speak now.');
		} catch (error) {
			if (!this.isCurrentSession(sessionId)) {
				this.disposeBackendInstance(backend);
				return;
			}
			const message = formatError(error);
			this.log(`Failed to start transcriber: ${message}`);
			vscode.window.showErrorMessage(`Echora Voice Pipeline: start failed (${message})`);
			this.endSession('Stopped because start() threw an error.');
		}
	}

	public async stopListening(reason = 'Stopped by user.'): Promise<void> {
		if (this.state === 'idle' && !this.processingTask) {
			return;
		}
		if (this.state !== 'idle') {
			this.endSession(reason);
		}
		this.cancelProcessing(reason);
		await this.waitForProcessingToFinish();
	}

	public dispose(): void {
		this.endSession('Stopped because extension was deactivated.');
		this.cancelProcessing('Stopped because extension was deactivated.');
		void this.waitForProcessingToFinish();
		this._onStateChanged.dispose();
		this.textConsumer.dispose();
	}

	private bindBackend(sessionId: number, backend: TranscriberBackend): void {
		this.backendListeners.push(
			backend.onResult((result) => {
				if (!this.isCurrentSession(sessionId)) {
					return;
				}
				void this.handleResult(sessionId, result);
			}),
			backend.onError((error) => {
				if (!this.isCurrentSession(sessionId)) {
					return;
				}
				this.handleBackendError(sessionId, error);
			}),
			backend.onDidStop(() => {
				if (!this.isCurrentSession(sessionId)) {
					return;
				}
				this.handleBackendStopped(sessionId);
			})
		);
	}

	private async handleResult(sessionId: number, result: TranscriptionResult): Promise<void> {
		if (!this.isCurrentSession(sessionId)) {
			return;
		}
		if (this.state !== 'listening' || this.processingFinalResult) {
			return;
		}

		const text = result.text.trim();
		if (!text) {
			return;
		}

		if (!result.isFinal) {
			this.log(`Partial: ${text}`);
			return;
		}

		this.processingFinalResult = true;
		this.log(`Final: ${text}`);
		this.transitionTo('transcribing', 'Final transcription received');

		const abortController = new AbortController();
		this.processingAbortController = abortController;
		const processingTask = this.processFinalResult(sessionId, text, abortController.signal);
		this.processingTask = processingTask;

		try {
			await processingTask;
		} finally {
			if (this.processingTask === processingTask) {
				this.processingTask = undefined;
			}
			if (this.processingAbortController === abortController) {
				this.processingAbortController = undefined;
			}
			if (this.isCurrentSession(sessionId)) {
				this.processingFinalResult = false;
			}
		}
	}

	private async processFinalResult(sessionId: number, text: string, signal: AbortSignal): Promise<void> {
		try {
			this.shutdownBackend();
			if (this.getState() !== 'transcribing') {
				return;
			}

			this.transitionTo('thinking', 'Dispatching text to consumer');
			await this.textConsumer.consume(
				{
					text,
					source: 'voice',
					createdAt: Date.now(),
				},
				{ signal }
			);
			if (!this.isCurrentSession(sessionId)) {
				return;
			}
			this.endSession('Consumer finished processing the message.');
		} catch (error) {
			if (isAbortError(error)) {
				this.log('Message processing aborted.');
				return;
			}
			if (!this.isCurrentSession(sessionId)) {
				return;
			}
			const message = formatError(error);
			this.log(`Message processing failed: ${message}`);
			vscode.window.showErrorMessage(`Echora Voice Pipeline: ${message}`);
			this.endSession('Reset after processing failure.');
		}
	}

	private handleBackendError(sessionId: number, error: Error): void {
		if (!this.isCurrentSession(sessionId)) {
			return;
		}
		if (this.state === 'idle') {
			return;
		}
		const message = formatError(error);
		this.log(`Transcriber error: ${message}`);
		vscode.window.showErrorMessage(`Echora Voice Pipeline: ${message}`);
		this.endSession('Stopped due to transcriber error.');
	}

	private handleBackendStopped(sessionId: number): void {
		if (!this.isCurrentSession(sessionId)) {
			return;
		}
		if (this.state === 'idle') {
			return;
		}
		this.log('Backend stopped.');
		this.endSession('Backend stopped.');
	}

	private endSession(reason: string): void {
		const hadActiveSession =
			this.state !== 'idle' || this.backend !== undefined || this.backendListeners.length > 0 || this.processingFinalResult;
		if (!hadActiveSession) {
			return;
		}
		this.activeSessionId += 1;
		this.processingFinalResult = false;
		this.shutdownBackend();
		this.transitionTo('idle', reason);
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

		for (const listener of this.backendListeners) {
			listener.dispose();
		}
		this.backendListeners = [];
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

	private transitionTo(next: PipelineState, reason: string): void {
		if (this.state === next) {
			return;
		}
		const previous = this.state;
		this.state = next;
		this.log(`State: ${previous} -> ${next} (${reason})`);
		this._onStateChanged.fire({ previous, current: next, reason });
	}

	private log(message: string): void {
		logWithScope('VoicePipeline', message);
	}

	private cancelProcessing(reason: string): void {
		const controller = this.processingAbortController;
		if (!controller || controller.signal.aborted) {
			return;
		}
		this.log(`Cancelling consumer processing (${reason}).`);
		controller.abort();
	}

	private async waitForProcessingToFinish(): Promise<void> {
		const task = this.processingTask;
		if (!task) {
			return;
		}
		try {
			await task;
		} catch {
			// swallow to keep stop/start sequencing resilient
		}
	}
}

function isAbortError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}
	const candidate = error as { name?: unknown; message?: unknown };
	return candidate.name === 'AbortError' || candidate.message === 'Processing aborted.';
}
