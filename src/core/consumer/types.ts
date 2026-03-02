import type * as vscode from 'vscode';
import type { PipelineTextMessage } from '../../types/pipeline';

export type TextConsumerOptions = {
	signal?: AbortSignal;
	resumeSessionId?: string;
};

export type ConsumerMessage =
	| { type: 'userMessage'; text: string }
	| { type: 'assistantThinkingDelta'; text: string }
	| { type: 'assistantDelta'; text: string }
	| { type: 'assistantDone'; text: string }
	| { type: 'error'; message: string }
	| { type: 'sessionCreated'; sessionId: string }
	| { type: 'toolUse'; toolUseId: string; toolName: string; inputSummary: string }
	| { type: 'toolProgress'; toolUseId: string; toolName: string; elapsedSeconds: number }
	| { type: 'toolResult'; toolUseId: string; isError: boolean; content: string }
	| { type: 'toolUseSummary'; summary: string }
	| { type: 'taskStarted'; taskId: string; description: string }
	| { type: 'taskProgress'; taskId: string; description: string; lastToolName?: string };

export interface TextConsumer {
	consume(message: PipelineTextMessage, options?: TextConsumerOptions): Promise<void>;
	onMessage?: vscode.Event<ConsumerMessage>;
	dispose(): void;
}
