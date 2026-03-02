import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';

export interface ThinkingStep {
	type: 'tool' | 'task';
	toolName?: string;
	inputSummary?: string;
	elapsedSeconds?: number;
	isError?: boolean;
	description?: string;
}

export interface HistoryEntry {
	timestamp: string;
	role: 'user' | 'assistant';
	content: string;
	sessionId: string;
	thinkingSteps?: ThinkingStep[];
	thinkingDurationSeconds?: number;
}

export class HistoryStore {
	private readonly filePath: string;

	constructor(storageUri: vscode.Uri) {
		this.filePath = path.join(storageUri.fsPath, 'history.jsonl');
	}

	async append(entry: HistoryEntry): Promise<void> {
		const dir = path.dirname(this.filePath);
		await fs.promises.mkdir(dir, { recursive: true });
		await fs.promises.appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
	}

	async readAll(): Promise<HistoryEntry[]> {
		let raw: string;
		try {
			raw = await fs.promises.readFile(this.filePath, 'utf8');
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			throw err;
		}
		const entries: HistoryEntry[] = [];
		for (const line of raw.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				entries.push(JSON.parse(trimmed) as HistoryEntry);
			} catch {
				// skip malformed lines
			}
		}
		return entries;
	}

	async archiveAndClear(): Promise<void> {
		const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
		const archivePath = path.join(
			path.dirname(this.filePath),
			`history-${timestamp}.jsonl`
		);
		await fs.promises.rename(this.filePath, archivePath);
	}
}
