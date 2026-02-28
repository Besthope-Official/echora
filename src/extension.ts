import * as vscode from 'vscode';
import { registerDictationCommands } from './commands/dictation';
import { registerPipelineCommands } from './commands/pipeline';
import { VoicePipeline } from './core/pipeline';
import { MockTextConsumer } from './core/consumer/mockTextConsumer';
import { AgentSdkTextConsumer } from './core/consumer/agentSdkTextConsumer';
import { resolveRemoteContext, createRemoteSpawner, resolveRemoteWorkingDirectory } from './core/consumer/remoteBridge';
import type { TextConsumer } from './core/consumer/types';
import { DictationService } from './core/stt/dictationService';
import { createNodeSpeechBackend } from './core/stt/nodeSpeechBackend';
import { PipelineStatusBar } from './ui/statusBar';
import { MicrophoneSessionCoordinator } from './core/microphoneSessionCoordinator';
import { disposeSharedOutputChannel } from './utils/outputLogger';

export function activate(context: vscode.ExtensionContext): void {
	const dictationService = new DictationService((log) => createNodeSpeechBackend(log));
	const pipeline = new VoicePipeline((log) => createNodeSpeechBackend(log), createTextConsumer(context));
	const sessionCoordinator = new MicrophoneSessionCoordinator(dictationService, pipeline);
	const dictationCommands = registerDictationCommands(sessionCoordinator);
	const pipelineCommands = registerPipelineCommands(sessionCoordinator);
	const statusBar = new PipelineStatusBar(pipeline);

	context.subscriptions.push(dictationService, pipeline, dictationCommands, pipelineCommands, statusBar);
}

export function deactivate(): void {
	disposeSharedOutputChannel();
}

function createTextConsumer(context: vscode.ExtensionContext): TextConsumer {
	const configured = vscode.workspace
		.getConfiguration('echora')
		.get<string>('pipeline.textConsumer', 'agent-sdk');

	if (configured === 'mock') {
		return new MockTextConsumer();
	}

	const remoteContext = resolveRemoteContext();
	const spawnClaudeCodeProcess = remoteContext ? createRemoteSpawner(remoteContext) : undefined;

	return new AgentSdkTextConsumer(
		() => resolveConsumerWorkingDirectory(context.extensionPath, remoteContext),
		context.extensionPath,
		spawnClaudeCodeProcess
	);
}

export function resolveConsumerWorkingDirectory(
	extensionPath: string,
	remoteContext: ReturnType<typeof resolveRemoteContext>
): string | undefined {
	const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (workspaceUri?.scheme === 'file') {
		return workspaceUri.fsPath;
	}

	if (remoteContext) {
		const remoteCwd = resolveRemoteWorkingDirectory(workspaceUri, remoteContext);
		if (remoteCwd) {
			return remoteCwd;
		}
	}

	// Fallback: keep SDK in the extension root even when workspace uri is unavailable in UI host.
	return extensionPath;
}
