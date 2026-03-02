import * as vscode from 'vscode';
import type { PipelineTextMessage } from '../../types/pipeline';
import { logWithScope } from '../../utils/outputLogger';
import type { ConsumerMessage, TextConsumer, TextConsumerOptions } from './types';

const MOCK_REPLY = 'This is a mock response from Echora.';

export class MockTextConsumer implements TextConsumer, vscode.Disposable {
	private readonly _onMessage = new vscode.EventEmitter<ConsumerMessage>();
	public readonly onMessage = this._onMessage.event;

	constructor(private readonly processingDelayMs = 2000) {}

	public async consume(
		message: PipelineTextMessage,
		options?: TextConsumerOptions
	): Promise<void> {
		this.log(`received from ${message.source}: ${message.text}`);
		this._onMessage.fire({ type: 'userMessage', text: message.text });

		if (this.processingDelayMs > 0) {
			await this.delay(this.processingDelayMs, options?.signal);
		}

		this._onMessage.fire({ type: 'assistantDelta', text: MOCK_REPLY });
		this._onMessage.fire({ type: 'assistantDone', text: MOCK_REPLY });
		this.log('message consumed.');
	}

	public dispose(): void {
		this._onMessage.dispose();
	}

	private delay(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (signal?.aborted) {
				reject(createAbortError());
				return;
			}
			const timer = setTimeout(() => {
				cleanup();
				resolve();
			}, ms);
			const onAbort = () => {
				clearTimeout(timer);
				cleanup();
				reject(createAbortError());
			};
			const cleanup = () => {
				signal?.removeEventListener('abort', onAbort);
			};
			signal?.addEventListener('abort', onAbort, { once: true });
		});
	}

	private log(message: string): void {
		logWithScope('MockTextConsumer', message);
	}
}

function createAbortError(): Error {
	const error = new Error('Processing aborted.');
	error.name = 'AbortError';
	return error;
}
