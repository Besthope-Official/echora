import type * as vscode from 'vscode';
import type { PipelineTextMessage } from '../../types/pipeline';

export type TextConsumerOptions = {
	signal?: AbortSignal;
};

export type ConsumerMessage =
	| { type: 'userMessage'; text: string }
	| { type: 'assistantDelta'; text: string }
	| { type: 'assistantDone'; text: string }
	| { type: 'error'; message: string };

export interface TextConsumer {
	consume(message: PipelineTextMessage, options?: TextConsumerOptions): Promise<void>;
	onMessage?: vscode.Event<ConsumerMessage>;
	dispose(): void;
}
