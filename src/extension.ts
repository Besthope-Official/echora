import * as vscode from 'vscode';
import { registerDictationCommands } from './commands/dictation';
import { registerPipelineCommands } from './commands/pipeline';
import { VoicePipeline } from './core/pipeline';
import { MockTextConsumer } from './core/consumer/mockTextConsumer';
import { AgentSdkTextConsumer } from './core/consumer/agentSdkTextConsumer';
import { resolveRemoteContext, createRemoteSpawner, resolveRemoteWorkingDirectory } from './core/consumer/remoteBridge';
import { loadSystemPrompt } from './core/consumer/promptLoader';
import type { TextConsumer } from './core/consumer/types';
import type { PipelineEditorContext } from './types/pipeline';
import { DictationService } from './core/stt/dictationService';
import { createNodeSpeechBackend } from './core/stt/nodeSpeechBackend';
import { createNodeSpeechTtsBackend } from './core/tts/nodeSpeechTtsBackend';
import type { SpeechSynthesizerBackend } from './core/tts/types';
import { PipelineStatusBar } from './ui/statusBar';
import { ChatPanel } from './ui/chatPanel';
import { MicrophoneSessionCoordinator } from './core/microphoneSessionCoordinator';
import { disposeSharedOutputChannel, logWithScope } from './utils/outputLogger';
import { SessionManager } from './core/session/sessionManager';
import { HistoryStore } from './core/session/historyStore';
import type { ThinkingStep } from './core/session/historyStore';

type TtsBackend = 'local';

export function activate(context: vscode.ExtensionContext): void {
	const sessionManager = new SessionManager(context.workspaceState);
	const historyStore = new HistoryStore(context.storageUri ?? context.globalStorageUri);
	logWithScope('HistoryStore', `history file: ${(context.storageUri ?? context.globalStorageUri).fsPath}/history.jsonl`);

	const dictationService = new DictationService((log) => createNodeSpeechBackend(log));
	const consumer = createTextConsumer(context, sessionManager);
	const pipeline = new VoicePipeline(
		(log) => createNodeSpeechBackend(log),
		consumer,
		() => vscode.workspace.getConfiguration('echora').get<boolean>('pipeline.enableTextEditingBeforeSend', false),
		(log) => createConfiguredTtsBackend(log),
		() => getTtsConfigKey()
	);

	if (consumer.onMessage) {
		type PendingToolStep = { type: 'tool'; toolName: string; inputSummary: string; elapsedSeconds: number; isError: boolean };
		type PendingStep = PendingToolStep | { type: 'task'; description: string };

		let pendingUserText = '';
		let pendingEditorContextHint: string | undefined;
		let turnStartMs: number | undefined;
		const pendingSteps: PendingStep[] = [];
		const pendingStepById = new Map<string, PendingToolStep>();

		context.subscriptions.push(
			consumer.onMessage((msg) => {
				if (msg.type === 'userMessage') {
					pendingUserText = msg.text;
					pendingEditorContextHint = formatEditorContextHint(pipeline.getLastCapturedEditorContext());
					pendingSteps.length = 0;
					pendingStepById.clear();
					turnStartMs = Date.now();
				} else if (msg.type === 'toolUse') {
					const step: PendingToolStep = { type: 'tool', toolName: msg.toolName, inputSummary: msg.inputSummary, elapsedSeconds: 0, isError: false };
					pendingSteps.push(step);
					pendingStepById.set(msg.toolUseId, step);
				} else if (msg.type === 'toolProgress') {
					const step = pendingStepById.get(msg.toolUseId);
					if (step) { step.elapsedSeconds = msg.elapsedSeconds; }
				} else if (msg.type === 'toolResult') {
					const step = pendingStepById.get(msg.toolUseId);
					if (step) { step.isError = msg.isError; }
				} else if (msg.type === 'taskStarted') {
					pendingSteps.push({ type: 'task', description: msg.description });
				} else if (msg.type === 'assistantDone' && pendingUserText) {
					const thinkingDurationSeconds = turnStartMs !== undefined ? Math.round((Date.now() - turnStartMs) / 1000) : 0;
					const capturedSteps: ThinkingStep[] | undefined = pendingSteps.length > 0 ? [...pendingSteps] : undefined;
					const sessionId = sessionManager.getSessionId() ?? '';
					const userText = pendingUserText;
					const editorContextHint = pendingEditorContextHint;
					pendingUserText = '';
					pendingEditorContextHint = undefined;
					pendingSteps.length = 0;
					pendingStepById.clear();
					turnStartMs = undefined;
					void historyStore.append({ timestamp: new Date().toISOString(), role: 'user', content: userText, sessionId, editorContextHint })
						.then(() => historyStore.append({ timestamp: new Date().toISOString(), role: 'assistant', content: msg.text, sessionId, thinkingSteps: capturedSteps, thinkingDurationSeconds }));
				}
			})
		);
	}

	const sessionCoordinator = new MicrophoneSessionCoordinator(dictationService, pipeline);
	const dictationCommands = registerDictationCommands(sessionCoordinator);
	const pipelineCommands = registerPipelineCommands(sessionCoordinator);
	const statusBar = new PipelineStatusBar(pipeline);
	const chatPanel = new ChatPanel(
		context.extensionUri,
		pipeline,
		consumer,
		() => historyStore.readAll(),
	);

	context.subscriptions.push(
		dictationService,
		pipeline,
		dictationCommands,
		pipelineCommands,
		statusBar,
		vscode.window.registerWebviewViewProvider('echora.chatPanel', chatPanel),
		chatPanel
	);
}

export function deactivate(): void {
	disposeSharedOutputChannel();
}

function createTextConsumer(context: vscode.ExtensionContext, sessionManager: SessionManager): TextConsumer {
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
		() => loadSystemPrompt(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
		spawnClaudeCodeProcess,
		() => sessionManager.getSessionId(),
		(sid) => { void sessionManager.setSessionId(sid); },
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

async function createConfiguredTtsBackend(
	log: (message: string) => void
): Promise<SpeechSynthesizerBackend | undefined> {
	const ttsEnabled = getTtsEnabled();
	if (!ttsEnabled) {
		return undefined;
	}

	const backend = getTtsBackend();
	switch (backend) {
		case 'local':
			return createNodeSpeechTtsBackend(log);
		default:
			log(`Unsupported TTS backend '${backend}'.`);
			return undefined;
	}
}

function getTtsEnabled(): boolean {
	return vscode.workspace.getConfiguration('echora').get<boolean>('tts.enabled', true);
}

function getTtsBackend(): TtsBackend {
	const configured = vscode.workspace.getConfiguration('echora').get<string>('tts.backend', 'local');
	return configured === 'local' ? configured : 'local';
}

function getTtsConfigKey(): string {
	return `${getTtsEnabled() ? 'enabled' : 'disabled'}:${getTtsBackend()}`;
}

function formatEditorContextHint(context: PipelineEditorContext | undefined): string | undefined {
	if (!context) {
		return undefined;
	}
	const s = context.selection;
	const rangeText = s.isEmpty
		? `${s.startLine + 1}:${s.startCharacter + 1}`
		: `${s.startLine + 1}:${s.startCharacter + 1}-${s.endLine + 1}:${s.endCharacter + 1}`;
	return `${context.filePath} @ ${rangeText}`;
}
