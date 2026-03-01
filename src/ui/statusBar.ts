import * as vscode from 'vscode';
import type { VoicePipeline } from '../core/pipeline';
import type { PipelineState } from '../types/pipeline';

export class PipelineStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly pipelineStateListener: vscode.Disposable;

	constructor(pipeline: VoicePipeline) {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.render(pipeline.getState());
		this.item.show();

		this.pipelineStateListener = pipeline.onStateChanged((change) => {
			this.render(change.current);
		});
	}

	public dispose(): void {
		this.pipelineStateListener.dispose();
		this.item.dispose();
	}

	private render(state: PipelineState): void {
		const isIdle = state === 'idle';
		this.item.command = isIdle ? 'echora.startVoicePipeline' : 'echora.stopVoicePipeline';
		this.item.tooltip = isIdle ? 'Echora Voice Pipeline: Click to Start' : 'Echora Voice Pipeline: Click to Stop';

		switch (state) {
			case 'idle':
				this.item.text = '$(coffee) Echora: Idle';
				break;
			case 'listening':
				this.item.text = '$(unmute) Echora: Listening';
				break;
			case 'transcribing':
				this.item.text = '$(sync~spin) Echora: Transcribing';
				break;
			case 'thinking':
				this.item.text = '$(sync~spin) Echora: Thinking';
				break;
			case 'awaitingSend':
				this.item.text = '$(edit) Echora: Awaiting Send';
				break;
			case 'speaking':
				this.item.text = '$(megaphone) Echora: Speaking';
				break;
		}
	}
}
