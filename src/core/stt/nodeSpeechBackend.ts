import { createDecipheriv, createHash } from 'crypto';
import { createRequire } from 'module';
import * as path from 'path';
import * as vscode from 'vscode';
import type { NodeSpeechModel, NodeSpeechModule, NodeSpeechRuntime } from '../../types/nodeSpeech';
import { formatError } from '../../utils/errors';
import { getPreferredNodeSpeechLocale, NODE_SPEECH_DEFAULT_LOCALE, normalizeLocale } from './locale';
import type { LogFn, TranscriberBackend, TranscriptionResult } from './types';

const NODE_SPEECH_EXTENSION_ID = 'ms-vscode.vscode-speech';
const SPEECH_LANGUAGE_PACK_EXTENSION_PREFIX = 'ms-vscode.vscode-speech-language-pack-';
const NODE_SPEECH_DEFAULT_MODEL_NAME = 'Microsoft Speech Recognizer en-US FP Model V9';
const SUPPORTED_RUNTIME_PLATFORMS = new Set(['win32', 'linux', 'darwin']);
const SUPPORTED_RUNTIME_ARCHS = new Set(['x64', 'arm64']);

class NodeSpeechBackend implements TranscriberBackend {
	private readonly _onResult = new vscode.EventEmitter<TranscriptionResult>();
	private readonly _onError = new vscode.EventEmitter<Error>();
	private readonly _onDidStop = new vscode.EventEmitter<void>();

	readonly onResult = this._onResult.event;
	readonly onError = this._onError.event;
	readonly onDidStop = this._onDidStop.event;

	private readonly transcriber;

	constructor(private readonly runtime: NodeSpeechRuntime) {
		this.transcriber = runtime.nodeSpeech.createTranscriber(
			{
				modelName: runtime.modelName,
				modelPath: runtime.modelPath,
				modelKey: runtime.modelKey,
			},
			(error, result) => {
				if (error) {
					this._onError.fire(error);
					return;
				}

				const statusName =
					this.runtime.nodeSpeech.TranscriptionStatusCode[result.status] ?? `STATUS_${result.status}`;

				if (statusName === 'RECOGNIZING' && result.data) {
					this._onResult.fire({ text: result.data, isFinal: false });
				} else if (statusName === 'RECOGNIZED' && result.data) {
					this._onResult.fire({ text: result.data, isFinal: true });
				} else if (statusName === 'ERROR') {
					this._onError.fire(new Error(result.data ?? 'Transcription engine error'));
				} else if (statusName === 'STOPPED' || statusName === 'DISPOSED') {
					this._onDidStop.fire();
				}
			}
		);
	}

	start(): void {
		this.transcriber.start();
	}

	stop(): void {
		this.transcriber.stop();
	}

	dispose(): void {
		this.transcriber.dispose();
		this._onResult.dispose();
		this._onError.dispose();
		this._onDidStop.dispose();
	}
}

export async function createNodeSpeechBackend(log: LogFn): Promise<TranscriberBackend> {
	if (vscode.env.remoteName === 'wsl' && process.platform === 'linux') {
		throw new Error(
			'NodeSpeech must run in UI host (Windows). Start Extension Development Host with --extensionDevelopmentKind=ui.'
		);
	}

	const speechExtension = vscode.extensions.getExtension(NODE_SPEECH_EXTENSION_ID);
	const overridePath = process.env.ECHORA_SPEECH_EXTENSION_PATH?.trim();
	if (overridePath) {
		log(`Using ECHORA_SPEECH_EXTENSION_PATH override: ${overridePath}`);
	}
	const speechExtensionPath = overridePath ? overridePath : speechExtension?.extensionPath;
	if (!overridePath && speechExtension?.extensionPath) {
		log(`Using installed speech extension path: ${speechExtension.extensionPath}`);
	}
	if (!speechExtensionPath) {
		throw new Error(
			`Required extension '${NODE_SPEECH_EXTENSION_ID}' is not available. ` +
				`Install "VS Code Speech" in this profile, or set ECHORA_SPEECH_EXTENSION_PATH explicitly.`
		);
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

	const models = new Map<string, NodeSpeechModel>();
	const normalizedSpeechExtensionId = NODE_SPEECH_EXTENSION_ID.toLowerCase();
	const defaultModel: NodeSpeechModel = {
		locale: NODE_SPEECH_DEFAULT_LOCALE,
		modelName: defaultModelName,
		modelPath: path.join(speechExtensionPath, 'assets', 'stt'),
		sourceExtensionId: NODE_SPEECH_EXTENSION_ID,
		version: '2',
	};
	models.set(defaultModel.locale.toLowerCase(), defaultModel);

	for (const extension of vscode.extensions.all) {
		const extensionId = extension.id.toLowerCase();
		if (
			extensionId !== normalizedSpeechExtensionId &&
			!extensionId.startsWith(SPEECH_LANGUAGE_PACK_EXTENSION_PREFIX)
		) {
			continue;
		}

		const contributed = (
			extension.packageJSON as { contributes?: { vscodeSpeechModels?: unknown } }
		).contributes?.vscodeSpeechModels;
		if (!Array.isArray(contributed)) {
			continue;
		}

		for (const item of contributed) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			const record = item as Record<string, unknown>;
			const rawLocale = typeof record.locale === 'string' ? record.locale : undefined;
			const modelName = typeof record.modelName === 'string' ? record.modelName : undefined;
			const modelPath = typeof record.modelPath === 'string' ? record.modelPath : undefined;
			if (!rawLocale || !modelName || !modelPath) {
				continue;
			}

			const locale = normalizeLocale(rawLocale) ?? rawLocale;
			models.set(locale.toLowerCase(), {
				locale,
				modelName,
				modelPath: path.join(extension.extensionPath, modelPath),
				sourceExtensionId: extension.id,
				version: typeof record.version === 'string' ? record.version : undefined,
			});
		}
	}

	const availableModels = Array.from(models.values());
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

	const runtime: NodeSpeechRuntime = {
		nodeSpeech,
		modelName: selectedModel.modelName,
		modelPath: selectedModel.modelPath,
		locale: selectedModel.locale,
		modelKey,
		speechExtensionPath,
	};

	log(
		`Loaded @vscode/node-speech from: ${path.join(
			runtime.speechExtensionPath,
			'node_modules',
			'@vscode',
			'node-speech'
		)}`
	);
	log(`Using locale: ${runtime.locale}`);
	log(`Using model: ${runtime.modelName}`);
	log(`Model path: ${runtime.modelPath}`);
	return new NodeSpeechBackend(runtime);
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

export function deriveNodeSpeechModelName(distCode: string): string {
	const sttModelMatch = distCode.match(
		/modelName:\"([^\"]+)\",modelPath:\(0,[^)]+\)\(__dirname,\"\.\.\",\"assets\",\"stt\"\)/
	);
	return sttModelMatch?.[1] ?? NODE_SPEECH_DEFAULT_MODEL_NAME;
}

export function deriveNodeSpeechModelKey(distCode: string): string {
	const licenseTextMatch = distCode.match(/\"(You may only use the C\/C\+\+ Extension[^\"]+)\"/);
	if (!licenseTextMatch) {
		throw new Error('Unable to parse VS Code Speech license text for model key derivation.');
	}

	const licenseText = JSON.parse(
		`"${licenseTextMatch[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
	) as string;
	const hexMatches = [...distCode.matchAll(/Buffer\.from\(\"([0-9a-f]+)\",\"hex\"\)/g)].map(
		(match) => match[1]
	);
	const tagHex = hexMatches.find((value) => value.length === 32);
	const ivHex = hexMatches.find((value) => value.length === 24);
	const cipherHex = hexMatches
		.filter((value) => value.length > 1000)
		.sort((a, b) => b.length - a.length)[0];

	if (!tagHex || !ivHex || !cipherHex) {
		throw new Error('Unable to parse encrypted model key payload from VS Code Speech extension.');
	}

	const hash = createHash('sha256').update(licenseText).digest();
	const decipher = createDecipheriv('aes-256-gcm', hash, Buffer.from(ivHex, 'hex'));
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString(
		'utf8'
	);
}

export function selectSpeechModel(models: NodeSpeechModel[], preferredLocale: string): NodeSpeechModel {
	const normalizedPreferred = (normalizeLocale(preferredLocale) ?? preferredLocale).toLowerCase();
	const byLocale = new Map(models.map((model) => [model.locale.toLowerCase(), model] as const));
	const exact = byLocale.get(normalizedPreferred);
	if (exact) {
		return exact;
	}

	const preferredLanguage = normalizedPreferred.split('-')[0];
	const languageMatch = models.find((model) =>
		model.locale.toLowerCase().startsWith(`${preferredLanguage}-`)
	);
	if (languageMatch) {
		return languageMatch;
	}

	const fallback = byLocale.get(NODE_SPEECH_DEFAULT_LOCALE.toLowerCase()) ?? models[0];
	if (!fallback) {
		throw new Error('No speech model discovered from VS Code Speech extensions.');
	}
	return fallback;
}
