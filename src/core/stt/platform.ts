import * as path from 'path';
import * as vscode from 'vscode';

const SUPPORTED_RUNTIME_PLATFORMS = new Set(['win32', 'linux', 'darwin']);
const SUPPORTED_RUNTIME_ARCHS = new Set(['x64', 'arm64']);

export function assertNodeSpeechUiHost(): void {
	// In Windows+WSL setups, microphone/STT must run in the local UI extension host.
	if (vscode.env.remoteName === 'wsl' && process.platform === 'linux') {
		throw new Error(
			'NodeSpeech must run in UI host (Windows). Start Extension Development Host with --extensionDevelopmentKind=ui.'
		);
	}
}

export function getRuntimeTarget(): string {
	const platform = SUPPORTED_RUNTIME_PLATFORMS.has(process.platform) ? process.platform : undefined;
	const arch = SUPPORTED_RUNTIME_ARCHS.has(process.arch) ? process.arch : undefined;
	if (!platform || !arch) {
		return `${process.platform}-${process.arch}`;
	}
	return `${platform}-${arch}`;
}

export function parseSpeechExtensionTarget(name: string): string | undefined {
	const match = name.match(/-(win32|linux|darwin)-(x64|arm64)$/);
	if (!match) {
		return undefined;
	}
	return `${match[1]}-${match[2]}`;
}

export function ensureSpeechExtensionTargetCompatibility(speechExtensionPath: string): void {
	const extensionTarget = parseSpeechExtensionTarget(path.basename(speechExtensionPath));
	if (!extensionTarget) {
		return;
	}

	const runtimeTarget = getRuntimeTarget();
	if (extensionTarget !== runtimeTarget) {
		throw new Error(
			`Incompatible VS Code Speech build selected: extension=${extensionTarget}, runtime=${runtimeTarget}. ` +
				`Install "VS Code Speech" for ${runtimeTarget} in this host/profile.`
		);
	}
}
