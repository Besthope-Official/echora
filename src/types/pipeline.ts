export type PipelineState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

export type PipelineMessageSource = 'voice';

export type PipelineTextMessage = {
	text: string;
	source: PipelineMessageSource;
	createdAt: number;
};

export type PipelineStateChange = {
	previous: PipelineState;
	current: PipelineState;
	reason: string;
};
