import type * as vscode from 'vscode';

export class SessionManager {
	constructor(private readonly state: vscode.Memento) {}

	getSessionId(): string | undefined {
		return this.state.get<string>('echora.session.id');
	}

	async setSessionId(id: string): Promise<void> {
		await this.state.update('echora.session.id', id);
	}

	async clearSession(): Promise<void> {
		await this.state.update('echora.session.id', undefined);
	}
}
