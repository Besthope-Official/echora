import type { PipelineTextMessage } from '../../types/pipeline';

export type TextConsumerOptions = {
	signal?: AbortSignal;
};

export interface TextConsumer {
	consume(message: PipelineTextMessage, options?: TextConsumerOptions): Promise<void>;
	dispose(): void;
}
