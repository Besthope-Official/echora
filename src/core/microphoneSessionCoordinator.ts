import type { DictationService } from './stt/dictationService';
import type { VoicePipeline } from './pipeline';

type AsyncTask<T> = () => Promise<T>;

export class MicrophoneSessionCoordinator {
	private taskQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly dictationService: DictationService,
		private readonly pipeline: VoicePipeline
	) {}

	public startDictation(): Promise<void> {
		return this.runExclusive(async () => {
			await this.pipeline.stopListening('Stopped because manual dictation is starting.');
			await this.dictationService.start();
		});
	}

	public stopDictation(reason = 'Stopped by user.'): Promise<void> {
		return this.runExclusive(async () => {
			await this.dictationService.stop(reason);
		});
	}

	public startPipeline(): Promise<void> {
		return this.runExclusive(async () => {
			await this.dictationService.stop('Stopped because voice pipeline is starting.');
			await this.pipeline.startListening();
		});
	}

	public stopPipeline(reason = 'Stopped by user.'): Promise<void> {
		return this.runExclusive(async () => {
			await this.pipeline.stopListening(reason);
		});
	}

	private runExclusive<T>(task: AsyncTask<T>): Promise<T> {
		const queuedTask = this.taskQueue.then(task, task);
		this.taskQueue = queuedTask.then(
			() => undefined,
			() => undefined
		);
		return queuedTask;
	}
}
