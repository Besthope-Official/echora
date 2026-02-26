import * as fs from 'fs/promises';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { NodeSpeechModule, NodeSpeechRuntime } from '../../types/nodeSpeech';
import { formatError } from '../../utils/errors';
import { getPreferredNodeSpeechLocale, normalizeLocale } from './locale';
import { deriveNodeSpeechModelKey, deriveNodeSpeechModelName } from './modelKey';
import {
	discoverSpeechModels,
	selectSpeechModel,
	SPEECH_LANGUAGE_PACK_EXTENSION_PREFIX,
} from './modelDiscovery';
import {
	ensureSpeechExtensionTargetCompatibility,
	getRuntimeTarget,
	parseSpeechExtensionTarget,
} from './platform';

const NODE_SPEECH_EXTENSION_ID = 'ms-vscode.vscode-speech';

type LogFn = (message: string) => void;

export async function resolveNodeSpeechRuntime(log: LogFn): Promise<NodeSpeechRuntime> {
	const speechExtension = vscode.extensions.getExtension(NODE_SPEECH_EXTENSION_ID);
	const overridePath = process.env.ECHORA_SPEECH_EXTENSION_PATH?.trim();
	if (overridePath) {
		log(`Using ECHORA_SPEECH_EXTENSION_PATH override: ${overridePath}`);
	}
	const speechExtensionPath = overridePath
		? overridePath
		: (speechExtension?.extensionPath ?? (await findSpeechExtensionPathOnDisk(log)));
	if (!overridePath && speechExtension?.extensionPath) {
		log(`Using installed speech extension path: ${speechExtension.extensionPath}`);
	}
	ensureSpeechExtensionTargetCompatibility(speechExtensionPath);

	const speechDistPath = path.join(speechExtensionPath, 'dist', 'extension.js');
	const speechDistUri = vscode.Uri.file(speechDistPath);
	const speechDistContent = await vscode.workspace.fs.readFile(speechDistUri);
	const speechDistCode = Buffer.from(speechDistContent).toString('utf8');
	const modelKey = deriveNodeSpeechModelKey(speechDistCode);
	const defaultModelName = deriveNodeSpeechModelName(speechDistCode);
	const preferredLocale = getPreferredNodeSpeechLocale();
	const normalizedPreferredLocale = (normalizeLocale(preferredLocale) ?? preferredLocale).toLowerCase();
	const availableModels = discoverSpeechModels(
		speechExtensionPath,
		NODE_SPEECH_EXTENSION_ID,
		defaultModelName
	);
	const selectedModel = selectSpeechModel(availableModels, preferredLocale);
	log(
		`Preferred locale: ${preferredLocale}. Available: ${availableModels
			.map((model) => model.locale)
			.join(', ')}`
	);
	if (selectedModel.locale.toLowerCase() !== normalizedPreferredLocale) {
		log(
			`Preferred locale ${preferredLocale} is not available. Falling back to ${selectedModel.locale}. ` +
				`Install language pack extension: ${SPEECH_LANGUAGE_PACK_EXTENSION_PREFIX}${preferredLocale.toLowerCase()}.`
		);
	}

	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(selectedModel.modelPath));
	} catch {
		throw new Error(`Speech model directory not found: ${selectedModel.modelPath}`);
	}

	const requireFromCurrentFile = createRequire(__filename);
	let nodeSpeech: NodeSpeechModule;
	try {
		nodeSpeech = requireFromCurrentFile(
			path.join(speechExtensionPath, 'node_modules', '@vscode', 'node-speech')
		) as NodeSpeechModule;
	} catch (error) {
		const runtimeTarget = getRuntimeTarget();
		const extensionTarget = parseSpeechExtensionTarget(path.basename(speechExtensionPath));
		const mismatchHint =
			extensionTarget && extensionTarget !== runtimeTarget
				? ` Target mismatch: extension=${extensionTarget}, runtime=${runtimeTarget}.`
				: '';
		throw new Error(
			`Failed to load @vscode/node-speech from VS Code Speech extension: ${formatError(
				error
			)}.${mismatchHint}`
		);
	}

	return {
		nodeSpeech,
		modelName: selectedModel.modelName,
		modelPath: selectedModel.modelPath,
		locale: selectedModel.locale,
		modelKey,
		speechExtensionPath,
	};
}

async function findSpeechExtensionPathOnDisk(log: LogFn): Promise<string> {
	const searchDirs = getSpeechExtensionSearchDirs();
	log(`Fallback search dirs (${searchDirs.length}): ${searchDirs.join(' | ')}`);
	const matches: Array<{ path: string; mtimeMs: number; target?: string }> = [];

	for (const dir of searchDirs) {
		let entries: Array<{ isDirectory(): boolean; name: string }>;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			if (!entry.name.startsWith(`${NODE_SPEECH_EXTENSION_ID}-`)) {
				continue;
			}

			const fullPath = path.join(dir, entry.name);
			if (!(await hasNodeSpeechRuntimePayload(fullPath))) {
				continue;
			}
			try {
				const stat = await fs.stat(fullPath);
				matches.push({
					path: fullPath,
					mtimeMs: stat.mtimeMs,
					target: parseSpeechExtensionTarget(entry.name),
				});
			} catch {
				// ignore broken entries
			}
		}
	}

	if (matches.length === 0) {
		throw new Error(
			`Required extension '${NODE_SPEECH_EXTENSION_ID}' is not available. ` +
				`Install "VS Code Speech" in this profile, or start without '--disable-extensions'.`
		);
	}

	const runtimeTarget = getRuntimeTarget();
	const compatibleMatches = matches.filter((match) => !match.target || match.target === runtimeTarget);
	if (compatibleMatches.length === 0) {
		const targets = Array.from(new Set(matches.map((match) => match.target ?? 'unknown'))).join(', ');
		throw new Error(
			`Found '${NODE_SPEECH_EXTENSION_ID}' but no build matches this extension host (${runtimeTarget}). ` +
				`Found targets: ${targets}. Install "VS Code Speech" for ${runtimeTarget} in this host/profile.`
		);
	}

	compatibleMatches.sort((a, b) => b.mtimeMs - a.mtimeMs);
	log(`Using fallback speech extension path: ${compatibleMatches[0].path}`);
	return compatibleMatches[0].path;
}

async function hasNodeSpeechRuntimePayload(extensionPath: string): Promise<boolean> {
	const distEntry = path.join(extensionPath, 'dist', 'extension.js');
	const nodeSpeechDir = path.join(extensionPath, 'node_modules', '@vscode', 'node-speech');
	try {
		await fs.stat(distEntry);
		await fs.stat(nodeSpeechDir);
		return true;
	} catch {
		return false;
	}
}

function getSpeechExtensionSearchDirs(): string[] {
	const dirs = new Set<string>();
	const explicit = process.env.VSCODE_EXTENSIONS;
	if (explicit && explicit.trim().length > 0) {
		dirs.add(explicit);
	}

	const home = os.homedir();
	dirs.add(path.join(home, '.vscode', 'extensions'));
	dirs.add(path.join(home, '.vscode-insiders', 'extensions'));
	dirs.add(path.join(home, '.vscode-oss', 'extensions'));
	dirs.add(path.join(home, '.cursor', 'extensions'));
	dirs.add(path.join(home, '.vscode-server', 'extensions'));
	dirs.add(path.join(home, '.vscode-server-insiders', 'extensions'));
	dirs.add(path.join(home, '.vscode-server-oss', 'extensions'));
	dirs.add(path.join(home, '.cursor-server', 'extensions'));

	return Array.from(dirs);
}
