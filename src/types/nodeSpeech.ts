export type NodeSpeechStatusResult = {
	status: number;
	data?: string;
};

export type NodeSpeechTranscriber = {
	start(): void;
	stop(): void;
	dispose(): void;
};

export type NodeSpeechModule = {
	TranscriptionStatusCode: Record<number, string>;
	createTranscriber(
		options: {
			modelPath: string;
			modelName: string;
			modelKey: string;
			phrases?: string[];
			logsPath?: string;
		},
		callback: (error: Error | undefined | null, result: NodeSpeechStatusResult) => void
	): NodeSpeechTranscriber;
};

export type NodeSpeechRuntime = {
	nodeSpeech: NodeSpeechModule;
	modelName: string;
	modelPath: string;
	locale: string;
	modelKey: string;
	speechExtensionPath: string;
};

export type NodeSpeechModel = {
	locale: string;
	modelName: string;
	modelPath: string;
	sourceExtensionId: string;
	version?: string;
};

export type NodeSpeechSession = {
	transcriber: NodeSpeechTranscriber;
	timeout: NodeJS.Timeout;
	runtime: NodeSpeechRuntime;
	stopping: boolean;
};
