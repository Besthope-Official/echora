import * as vscode from 'vscode';
import { registerDictationCommands } from './commands/dictation';
import { registerPipelineCommands } from './commands/pipeline';
import { VoicePipeline } from './core/pipeline';
import { MockTextConsumer } from './core/consumer/mockTextConsumer';
import { DictationService } from './core/stt/dictationService';
import { createNodeSpeechBackend } from './core/stt/nodeSpeechBackend';
import { PipelineStatusBar } from './ui/statusBar';
import { MicrophoneSessionCoordinator } from './core/microphoneSessionCoordinator';
import { disposeSharedOutputChannel } from './utils/outputLogger';

export function activate(context: vscode.ExtensionContext): void {
	const dictationService = new DictationService((log) => createNodeSpeechBackend(log));
	const pipeline = new VoicePipeline((log) => createNodeSpeechBackend(log), new MockTextConsumer());
	const sessionCoordinator = new MicrophoneSessionCoordinator(dictationService, pipeline);
	const dictationCommands = registerDictationCommands(sessionCoordinator);
	const pipelineCommands = registerPipelineCommands(sessionCoordinator);
	const statusBar = new PipelineStatusBar(pipeline);

	context.subscriptions.push(dictationService, pipeline, dictationCommands, pipelineCommands, statusBar);
}

export function deactivate(): void {
	disposeSharedOutputChannel();
}
