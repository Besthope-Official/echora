import * as vscode from 'vscode';
import type { VoicePipeline } from '../core/pipeline';
import type { TextConsumer, ConsumerMessage } from '../core/consumer/types';

type HostToWebviewMessage =
	| { type: 'userMessage'; text: string }
	| { type: 'assistantDelta'; text: string }
	| { type: 'assistantDone' }
	| { type: 'error'; message: string }
	| { type: 'stateChanged'; state: string }
	| { type: 'pendingTranscription'; text: string }
	| { type: 'pendingCleared' };

type WebviewToHostMessage = { type: 'sendPendingTranscription'; text: string };

export class ChatPanel implements vscode.WebviewViewProvider, vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private view: vscode.WebviewView | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly pipeline: VoicePipeline,
		consumer: TextConsumer
	) {
		if (consumer.onMessage) {
			this.disposables.push(
				consumer.onMessage((msg) => this.handleConsumerMessage(msg))
			);
		}

		this.disposables.push(
			this.pipeline.onStateChanged((change) => {
				this.postMessage({ type: 'stateChanged', state: change.current });
			}),
			this.pipeline.onPendingTranscriptionChanged((text) => {
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
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};
		webviewView.webview.html = this.getHtml();
		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
				void this.handleWebviewMessage(message);
			})
		);
		this.postMessage({ type: 'stateChanged', state: this.pipeline.getState() });
		const pending = this.pipeline.getPendingTranscription();
		if (typeof pending === 'string') {
			this.postMessage({ type: 'pendingTranscription', text: pending });
		}
	}

	public dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
	}

	private handleConsumerMessage(msg: ConsumerMessage): void {
		switch (msg.type) {
			case 'userMessage':
				this.postMessage({ type: 'userMessage', text: msg.text });
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
		}
	}

	private async handleWebviewMessage(message: WebviewToHostMessage): Promise<void> {
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

	private getHtml(): string {
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
	*{box-sizing:border-box;margin:0;padding:0}
	body{
		font-family:var(--vscode-font-family,sans-serif);
		font-size:var(--vscode-font-size,13px);
		color:var(--vscode-foreground);
		background:var(--vscode-sideBar-background,transparent);
		padding:8px;
	}
	#messages{display:flex;flex-direction:column;gap:8px}
	.msg{
		padding:8px 12px;
		border-radius:6px;
		white-space:pre-wrap;
		word-break:break-word;
		line-height:1.45;
		max-width:100%;
	}
	.msg.user{
		background:var(--vscode-input-background);
		align-self:flex-end;
	}
	.msg.assistant{
		background:var(--vscode-editor-background);
		align-self:flex-start;
	}
	.msg.error{
		background:var(--vscode-inputValidation-errorBackground,#5a1d1d);
		border:1px solid var(--vscode-inputValidation-errorBorder,#be1100);
		align-self:stretch;
	}
	#draft-wrap{
		display:none;
		margin-bottom:10px;
	}
	#draft-label{
		font-size:0.85em;
		opacity:0.8;
		margin-bottom:4px;
	}
	#draft-input{
		width:100%;
		min-height:72px;
		resize:vertical;
		padding:8px;
		border:1px solid var(--vscode-input-border,transparent);
		border-radius:6px;
		background:var(--vscode-input-background);
		color:var(--vscode-input-foreground);
		font-family:var(--vscode-editor-font-family,var(--vscode-font-family,sans-serif));
	}
	#draft-actions{
		display:flex;
		justify-content:flex-end;
		margin-top:6px;
	}
	#send-btn{
		padding:5px 10px;
		border:1px solid var(--vscode-button-border,transparent);
		background:var(--vscode-button-background);
		color:var(--vscode-button-foreground);
		border-radius:4px;
		cursor:pointer;
	}
	#send-btn:disabled{
		opacity:0.6;
		cursor:not-allowed;
	}
	#state-indicator{
		text-align:center;
		padding:4px;
		font-size:0.85em;
		opacity:0.7;
	}
</style>
</head>
<body>
	<div id="state-indicator"></div>
	<div id="draft-wrap">
		<div id="draft-label">Transcription ready. Edit and send.</div>
		<textarea id="draft-input" placeholder="Review transcription before sending"></textarea>
		<div id="draft-actions">
			<button id="send-btn" type="button">Send</button>
		</div>
	</div>
	<div id="messages"></div>
	<script>
	(function(){
		const vscode = acquireVsCodeApi();
		const container = document.getElementById('messages');
		const stateEl = document.getElementById('state-indicator');
		const draftWrap = document.getElementById('draft-wrap');
		const draftInput = document.getElementById('draft-input');
		const sendBtn = document.getElementById('send-btn');
		let currentAssistantEl = null;
		let hasPendingDraft = false;

		sendBtn.addEventListener('click', sendPendingTranscription);
		draftInput.addEventListener('keydown', e => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
				e.preventDefault();
				sendPendingTranscription();
			}
		});

		window.addEventListener('message', e => {
			const msg = e.data;
			switch(msg.type){
				case 'userMessage': {
					finishAssistant();
					const el = document.createElement('div');
					el.className = 'msg user';
					el.textContent = msg.text;
					container.appendChild(el);
					scrollToBottom();
					break;
				}
				case 'assistantDelta': {
					if(!currentAssistantEl){
						currentAssistantEl = document.createElement('div');
						currentAssistantEl.className = 'msg assistant';
						container.appendChild(currentAssistantEl);
					}
					currentAssistantEl.textContent += msg.text;
					scrollToBottom();
					break;
				}
				case 'assistantDone': {
					finishAssistant();
					break;
				}
				case 'error': {
					finishAssistant();
					const el = document.createElement('div');
					el.className = 'msg error';
					el.textContent = msg.message;
					container.appendChild(el);
					scrollToBottom();
					break;
				}
				case 'stateChanged': {
					if(msg.state === 'idle'){
						stateEl.textContent = '';
					} else {
						stateEl.textContent = msg.state === 'awaitingSend' ? 'awaiting send...' : msg.state + '...';
					}
					const isBusy = msg.state === 'thinking' || msg.state === 'transcribing';
					if (hasPendingDraft) {
						sendBtn.disabled = isBusy;
					}
					break;
				}
				case 'pendingTranscription': {
					hasPendingDraft = true;
					draftWrap.style.display = 'block';
					draftInput.value = msg.text;
					sendBtn.disabled = false;
					draftInput.focus();
					const len = draftInput.value.length;
					draftInput.setSelectionRange(len, len);
					scrollToBottom();
					break;
				}
				case 'pendingCleared': {
					hasPendingDraft = false;
					draftInput.value = '';
					sendBtn.disabled = false;
					draftWrap.style.display = 'none';
					break;
				}
			}
		});

		function finishAssistant(){
			currentAssistantEl = null;
		}

		function scrollToBottom(){
			requestAnimationFrame(() => {
				window.scrollTo(0, document.body.scrollHeight);
			});
		}

		function sendPendingTranscription(){
			const text = draftInput.value;
			if(!text.trim()){
				return;
			}
			sendBtn.disabled = true;
			vscode.postMessage({ type: 'sendPendingTranscription', text });
		}
	})();
	</script>
</body>
</html>`;
	}
}
