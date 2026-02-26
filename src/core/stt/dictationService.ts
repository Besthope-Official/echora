import * as path from 'path';
import * as vscode from 'vscode';
import type { NodeSpeechSession, NodeSpeechStatusResult } from '../../types/nodeSpeech';
import { formatError } from '../../utils/errors';
import { assertNodeSpeechUiHost } from './platform';
import { resolveNodeSpeechRuntime } from './runtimeResolver';

const NODE_SPEECH_SESSION_DURATION_MS = 20_000;

export class DictationService implements vscode.Disposable {
	private outputChannel: vscode.OutputChannel | undefined;
	private session: NodeSpeechSession | undefined;

	public async start(): Promise<void> {
		const output = this.getOutputChannel();
		output.show(true);
		assertNodeSpeechUiHost();
		if (this.session && !this.session.stopping) {
			this.log('A voice input session is already running.');
			return;
		}

		this.log(
			`Starting voice input session. remoteName=${vscode.env.remoteName ?? 'none'}, uiKind=${
				vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'web'
			}.`
		);
		this.log(`Host runtime: platform=${process.platform}, arch=${process.arch}, node=${process.version}.`);
		let runtime;
		try {
			runtime = await resolveNodeSpeechRuntime((message) => {
				this.log(message);
			});
		} catch (error) {
			const message = formatError(error);
			this.log(`Runtime initialization failed: ${message}`);
			vscode.window.showErrorMessage(`Echora Voice Input: ${message}`);
			return;
		}

		this.log(
			`Loaded @vscode/node-speech from: ${path.join(
				runtime.speechExtensionPath,
				'node_modules',
				'@vscode',
				'node-speech'
			)}`
		);
		this.log(`Using locale: ${runtime.locale}`);
		this.log(`Using model: ${runtime.modelName}`);
		this.log(`Model path: ${runtime.modelPath}`);

		const transcriber = runtime.nodeSpeech.createTranscriber(
			{
				modelName: runtime.modelName,
				modelPath: runtime.modelPath,
				modelKey: runtime.modelKey,
			},
			(error, result) => {
				void this.handleCallback(error, result);
			}
		);

		const timeout = setTimeout(() => {
			void this.stop(`Auto-stopped after ${NODE_SPEECH_SESSION_DURATION_MS / 1000}s.`);
		}, NODE_SPEECH_SESSION_DURATION_MS);

		this.session = {
			transcriber,
			timeout,
			runtime,
			stopping: false,
		};

		try {
			transcriber.start();
			this.log('Transcriber started. Speak now and check callback status logs below.');
		} catch (error) {
			const message = formatError(error);
			this.log(`Failed to start transcriber: ${message}`);
			await this.stop('Stopped because start() threw an error.');
			vscode.window.showErrorMessage(`Echora Voice Input: start failed (${message})`);
		}
	}

	public async stop(reason: string): Promise<void> {
		const session = this.session;
		if (!session || session.stopping) {
			return;
		}
		session.stopping = true;
		clearTimeout(session.timeout);
		this.log(reason);

		try {
			session.transcriber.stop();
		} catch (error) {
			this.log(`transcriber.stop() failed: ${formatError(error)}`);
		}
		try {
			session.transcriber.dispose();
		} catch (error) {
			this.log(`transcriber.dispose() failed: ${formatError(error)}`);
		}

		this.session = undefined;
	}

	public dispose(): void {
		void this.stop('Stopped because extension was deactivated.');
		if (this.outputChannel) {
			this.outputChannel.dispose();
			this.outputChannel = undefined;
		}
	}

	private async handleCallback(
		error: Error | undefined | null,
		result: NodeSpeechStatusResult
	): Promise<void> {
		const session = this.session;
		if (!session) {
			return;
		}

		if (error) {
			this.log(`Callback error: ${error.message}`);
			await this.stop('Stopped due to callback error.');
			return;
		}

		const statusName =
			session.runtime.nodeSpeech.TranscriptionStatusCode[result.status] ?? `STATUS_${result.status}`;
		const text = typeof result.data === 'string' && result.data.length > 0 ? ` | ${result.data}` : '';
		this.log(`Callback: ${statusName}${text}`);

		if (statusName === 'ERROR' || statusName === 'STOPPED' || statusName === 'DISPOSED') {
			await this.stop(`Stopped after ${statusName}.`);
		}
	}

	private getOutputChannel(): vscode.OutputChannel {
		if (!this.outputChannel) {
			this.outputChannel = vscode.window.createOutputChannel('Echora Voice Input');
		}
		return this.outputChannel;
	}

	private log(message: string): void {
		this.getOutputChannel().appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
	}
}
