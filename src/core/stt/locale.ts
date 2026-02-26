import * as vscode from 'vscode';

export const NODE_SPEECH_DEFAULT_LOCALE = 'en-US';

export function getPreferredNodeSpeechLocale(): string {
	const configured = vscode.workspace
		.getConfiguration('echora')
		.get<string>('nodeSpeech.locale', 'auto')
		?.trim();
	if (!configured || configured.toLowerCase() === 'auto') {
		return normalizeLocale(vscode.env.language) ?? NODE_SPEECH_DEFAULT_LOCALE;
	}
	return normalizeLocale(configured) ?? configured;
}

export function normalizeLocale(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.trim().replace(/_/g, '-');
	if (normalized.length === 0) {
		return undefined;
	}

	const lower = normalized.toLowerCase();
	if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-hans' || lower === 'zh-hans-cn') {
		return 'zh-CN';
	}
	if (lower === 'en') {
		return 'en-US';
	}

	const parts = normalized.split('-');
	if (parts.length === 1) {
		return parts[0].toLowerCase();
	}

	return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
}
