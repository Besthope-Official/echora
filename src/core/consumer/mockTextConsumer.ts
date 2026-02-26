import type * as vscode from 'vscode';
import type { PipelineTextMessage } from '../../types/pipeline';
import { logWithScope } from '../../utils/outputLogger';
import type { TextConsumer, TextConsumerOptions } from './types';

export class MockTextConsumer implements TextConsumer, vscode.Disposable {
	constructor(private readonly processingDelayMs = 2000) {}

	public async consume(message: PipelineTextMessage, options?: TextConsumerOptions): Promise<void> {
		this.log(`received from ${message.source}: ${message.text}`);
		if (this.processingDelayMs > 0) {
			await this.delay(this.processingDelayMs, options?.signal);
		}
		this.log('message consumed.');
	}

	public dispose(): void {}

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
