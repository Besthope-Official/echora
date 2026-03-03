import * as vscode from 'vscode';
import * as fs from 'fs';
import type { VoicePipeline } from '../core/pipeline';
import type { TextConsumer, ConsumerMessage } from '../core/consumer/types';
import type { HistoryEntry } from '../core/session/historyStore';

type HostToWebviewMessage =
	| { type: 'userMessage'; text: string; editorContextHint?: string }
	| { type: 'assistantThinkingDelta'; text: string }
	| { type: 'assistantDelta'; text: string }
	| { type: 'assistantDone' }
	| { type: 'error'; message: string }
	| { type: 'stateChanged'; state: string }
	| { type: 'pendingTranscription'; text: string }
	| { type: 'pendingCleared' }
	| { type: 'loadHistory'; entries: HistoryEntry[] }
	| { type: 'toolUse'; toolUseId: string; toolName: string; inputSummary: string }
	| { type: 'toolProgress'; toolUseId: string; toolName: string; elapsedSeconds: number }
	| { type: 'toolResult'; toolUseId: string; isError: boolean; content: string }
	| { type: 'toolUseSummary'; summary: string }
	| { type: 'taskStarted'; taskId: string; description: string }
	| { type: 'taskProgress'; taskId: string; description: string; lastToolName?: string };

type WebviewToHostMessage =
	| { type: 'sendPendingTranscription'; text: string }
	| { type: 'webviewReady' };

export class ChatPanel implements vscode.WebviewViewProvider, vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private view: vscode.WebviewView | undefined;

	private messageQueue: ConsumerMessage[] = [];
	private isWebviewReady: boolean = false;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly pipeline: VoicePipeline,
		consumer: TextConsumer,
		private readonly readHistory?: () => Promise<HistoryEntry[]>,
	) {
		if (consumer.onMessage) {
			this.disposables.push(
				consumer.onMessage((msg) => this.handleConsumerMessage(msg))
			);
		}

		this.disposables.push(
			this.pipeline.onStateChanged((change) => {
				if (this.canDeliverMessages()) {
					this.postMessage({ type: 'stateChanged', state: change.current });
				}
			}),
			this.pipeline.onPendingTranscriptionChanged((text) => {
				if (!this.canDeliverMessages()) {
					return;
				}
				if (typeof text === 'string') {
					this.postMessage({ type: 'pendingTranscription', text });
					return;
				}
				this.postMessage({ type: 'pendingCleared' });
			}),
		);
	}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		this.isWebviewReady = false;
		const webviewRoot = this.getWebviewRoot();
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [webviewRoot],
		};
		webviewView.webview.html = this.getHtml(webviewView.webview, webviewRoot);
		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
				void this.handleWebviewMessage(message);
			}),
			webviewView.onDidDispose(() => {
				if (this.view === webviewView) {
					this.view = undefined;
					this.isWebviewReady = false;
				}
			}),
			webviewView.onDidChangeVisibility(() => {
				if (!webviewView.visible || !this.canDeliverMessages()) {
					return;
				}
				this.postPipelineSnapshot();
				this.flushQueuedMessages();
			}),
		);
		// Initial state and history are sent in response to 'webviewReady' from the webview,
		// ensuring the JS listener is registered before messages arrive.
	}

	public dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
	}

	private handleConsumerMessage(msg: ConsumerMessage): void {
		if (!this.canDeliverMessages()) {
			this.messageQueue.push(msg);
			return;
		}
		this.dispatchConsumerMessage(msg);
	}

	private dispatchConsumerMessage(msg: ConsumerMessage): void {
		switch (msg.type) {
			case 'userMessage':
				this.postMessage({ type: 'userMessage', text: msg.text, editorContextHint: msg.editorContextHint });
				break;
			case 'assistantThinkingDelta':
				this.postMessage({ type: 'assistantThinkingDelta', text: msg.text });
				break;
			case 'assistantDelta':
				this.postMessage({ type: 'assistantDelta', text: msg.text });
				break;
			case 'assistantDone':
				this.postMessage({ type: 'assistantDone' });
				break;
			case 'error':
				this.postMessage({ type: 'error', message: msg.message });
				break;
			case 'toolUse':
				this.postMessage({ type: 'toolUse', toolUseId: msg.toolUseId, toolName: msg.toolName, inputSummary: msg.inputSummary });
				break;
			case 'toolProgress':
				this.postMessage({ type: 'toolProgress', toolUseId: msg.toolUseId, toolName: msg.toolName, elapsedSeconds: msg.elapsedSeconds });
				break;
			case 'toolResult':
				this.postMessage({ type: 'toolResult', toolUseId: msg.toolUseId, isError: msg.isError, content: msg.content });
				break;
			case 'toolUseSummary':
				this.postMessage({ type: 'toolUseSummary', summary: msg.summary });
				break;
			case 'taskStarted':
				this.postMessage({ type: 'taskStarted', taskId: msg.taskId, description: msg.description });
				break;
			case 'taskProgress':
				this.postMessage({ type: 'taskProgress', taskId: msg.taskId, description: msg.description, lastToolName: msg.lastToolName });
				break;
			case 'sessionCreated':
				break;
		}
	}

	private async handleWebviewMessage(message: WebviewToHostMessage): Promise<void> {
		if (message.type === 'webviewReady') {
			this.postPipelineSnapshot();
			if (this.readHistory) {
				try {
					const entries = await this.readHistory();
					if (entries.length > 0) {
						this.postMessage({ type: 'loadHistory', entries });
					}
				} catch (err) {
					console.error('Failed to load history:', err);
					this.postMessage({ type: 'error', message: 'Failed to load chat history.' });
				}
			}
			this.isWebviewReady = true;
			this.flushQueuedMessages();
			return;
		}
		if (message.type !== 'sendPendingTranscription') {
			return;
		}
		try {
			await this.pipeline.submitPendingTranscription(message.text);
		} catch (error) {
			const description = error instanceof Error ? error.message : String(error);
			this.postMessage({ type: 'error', message: `Failed to send transcription: ${description}` });
		}
	}

	private postMessage(message: HostToWebviewMessage): void {
		void this.view?.webview.postMessage(message);
	}

	private canDeliverMessages(): boolean {
		return this.isWebviewReady && this.view?.visible === true;
	}

	private flushQueuedMessages(): void {
		if (!this.canDeliverMessages() || this.messageQueue.length === 0) {
			return;
		}
		for (const msg of this.messageQueue) {
			this.dispatchConsumerMessage(msg);
		}
		this.messageQueue = [];
	}

	private postPipelineSnapshot(): void {
		this.postMessage({ type: 'stateChanged', state: this.pipeline.getState() });
		const pending = this.pipeline.getPendingTranscription();
		if (typeof pending === 'string') {
			this.postMessage({ type: 'pendingTranscription', text: pending });
			return;
		}
		this.postMessage({ type: 'pendingCleared' });
	}

	private getWebviewRoot(): vscode.Uri {
		return vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat');
	}

	private getHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
		const templateUri = vscode.Uri.joinPath(webviewRoot, 'index.html');
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'styles.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.js'));

		let template: string;
		try {
			template = fs.readFileSync(templateUri.fsPath, 'utf8');
		} catch (error) {
			return this.buildAssetLoadErrorHtml(error);
		}

		return template
			.split('{{cspSource}}').join(webview.cspSource)
			.split('{{styleUri}}').join(styleUri.toString())
			.split('{{scriptUri}}').join(scriptUri.toString());
	}

	private buildAssetLoadErrorHtml(error: unknown): string {
		const detail = error instanceof Error ? error.message : String(error);
		return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body>Failed to load chat webview assets: ${this.escapeHtml(detail)}</body>
</html>`;
	}

	private escapeHtml(value: string): string {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}
}
