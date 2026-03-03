export type PipelineState = 'idle' | 'listening' | 'transcribing' | 'awaitingSend' | 'thinking' | 'speaking';

export type PipelineMessageSource = 'voice';

export type PipelineEditorSelection = {
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
	isEmpty: boolean;
};

export type PipelineEditorContext = {
	filePath: string;
	languageId: string;
	selection: PipelineEditorSelection;
	selectedText: string;
};

export type PipelineTextMessage = {
	text: string;
	source: PipelineMessageSource;
	createdAt: number;
	context?: PipelineEditorContext;
};

export type PipelineStateChange = {
	previous: PipelineState;
	current: PipelineState;
	reason: string;
};
