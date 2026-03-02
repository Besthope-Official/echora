import { createRequire } from 'module';
import * as path from 'path';
import * as vscode from 'vscode';
import type { NodeSpeechModel, NodeSpeechModule, NodeSpeechSynthesizer } from '../../types/nodeSpeech';
import { formatError } from '../../utils/errors';
import {
	deriveNodeSpeechModelKey,
	ensureSpeechExtensionTargetCompatibility,
	selectSpeechModel,
} from '../stt/nodeSpeechBackend';
import { getPreferredNodeSpeechLocale, NODE_SPEECH_DEFAULT_LOCALE, normalizeLocale } from '../stt/locale';
import type { LogFn, SpeechSynthesizerBackend } from './types';

const NODE_SPEECH_EXTENSION_ID = 'ms-vscode.vscode-speech';
const SPEECH_LANGUAGE_PACK_EXTENSION_PREFIX = 'ms-vscode.vscode-speech-language-pack-';
const NODE_SPEECH_DEFAULT_SYNTHESIZER_MODEL_NAME =
	'Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)';

type NodeSpeechSynthesizerRuntime = {
	nodeSpeech: NodeSpeechModule;
	modelName: string;
	modelPath: string;
	locale: string;
	modelKey: string;
	speechExtensionPath: string;
};

class NodeSpeechTtsBackend implements SpeechSynthesizerBackend {
	private activeSynthesizer: NodeSpeechSynthesizer | undefined;
	private stopActiveSynthesis: (() => void) | undefined;
	private disposed = false;

	constructor(
		private readonly runtime: NodeSpeechSynthesizerRuntime,
		private readonly log: LogFn
	) {}

	public async speak(text: string, signal?: AbortSignal): Promise<void> {
		const content = text.trim();
		if (!content) {
			return;
		}
		if (this.disposed) {
			throw new Error('TTS backend has been disposed.');
		}

		this.stop();

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let abortListener: (() => void) | undefined;
			let synth: NodeSpeechSynthesizer | undefined;

			const complete = (next: () => void): void => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				next();
			};

			const fail = (error: unknown): void => {
				const value = error instanceof Error ? error : new Error(String(error));
				complete(() => reject(value));
			};

			const cleanup = (): void => {
				if (abortListener && signal) {
					signal.removeEventListener('abort', abortListener);
				}
				abortListener = undefined;
				if (this.stopActiveSynthesis === onAbort) {
					this.stopActiveSynthesis = undefined;
				}
				if (synth && this.activeSynthesizer === synth) {
					this.activeSynthesizer = undefined;
				}
				if (synth) {
					try {
						synth.dispose();
					} catch (error) {
						this.log(`synthesizer.dispose() failed: ${formatError(error)}`);
					}
				}
			};

			const onAbort = (): void => {
				if (settled) {
					return;
				}
				try {
					synth?.stop();
				} catch (error) {
					this.log(`synthesizer.stop() failed during abort: ${formatError(error)}`);
				}
				fail(createAbortError());
			};

			try {
				synth = this.runtime.nodeSpeech.createSynthesizer(
					{
						modelName: this.runtime.modelName,
						modelPath: this.runtime.modelPath,
						modelKey: this.runtime.modelKey,
					},
					(error, result) => {
						if (settled) {
							return;
						}
						if (error) {
							fail(error);
							return;
						}

						const statusName =
							this.runtime.nodeSpeech.SynthesizerStatusCode[result.status] ??
							`STATUS_${result.status}`;
						if (statusName === 'STARTED') {
							return;
						}
						if (statusName === 'STOPPED' || statusName === 'DISPOSED') {
							complete(resolve);
							return;
						}
						if (statusName === 'ERROR') {
							fail(new Error(result.data ?? 'Synthesis engine error'));
						}
					}
				);
			} catch (error) {
				fail(error);
				return;
			}

			this.activeSynthesizer = synth;
			this.stopActiveSynthesis = onAbort;

			if (signal) {
				if (signal.aborted) {
					onAbort();
					return;
				}
				abortListener = onAbort;
				signal.addEventListener('abort', abortListener, { once: true });
			}

			try {
				synth.synthesize(content);
			} catch (error) {
				fail(error);
			}
		});
	}

	public stop(): void {
		this.stopActiveSynthesis?.();
		this.stopActiveSynthesis = undefined;

		const synth = this.activeSynthesizer;
		this.activeSynthesizer = undefined;
		if (!synth) {
			return;
		}
		try {
			synth.stop();
		} catch (error) {
			this.log(`synthesizer.stop() failed: ${formatError(error)}`);
		}
		try {
			synth.dispose();
		} catch (error) {
			this.log(`synthesizer.dispose() failed: ${formatError(error)}`);
		}
	}

	public dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.stop();
	}
}

export async function createNodeSpeechTtsBackend(log: LogFn): Promise<SpeechSynthesizerBackend> {
	if (vscode.env.remoteName === 'wsl' && process.platform === 'linux') {
		throw new Error(
			'NodeSpeech TTS must run in UI host (Windows). Start Extension Development Host with --extensionDevelopmentKind=ui.'
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
	const defaultModelName = deriveNodeSpeechSynthesizerModelName(speechDistCode);
	const preferredLocale = getPreferredNodeSpeechLocale();
	const normalizedPreferredLocale = (normalizeLocale(preferredLocale) ?? preferredLocale).toLowerCase();

	const models = new Map<string, NodeSpeechModel>();
	const normalizedSpeechExtensionId = NODE_SPEECH_EXTENSION_ID.toLowerCase();
	const defaultModel: NodeSpeechModel = {
		locale: NODE_SPEECH_DEFAULT_LOCALE,
		modelName: defaultModelName,
		modelPath: path.join(speechExtensionPath, 'assets', 'tts'),
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
			extension.packageJSON as { contributes?: { vscodeSynthesizerModels?: unknown } }
		).contributes?.vscodeSynthesizerModels;
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
		`Preferred locale: ${preferredLocale}. Available synthesizer models: ${availableModels
			.map((model) => model.locale)
			.join(', ')}`
	);
	if (selectedModel.locale.toLowerCase() !== normalizedPreferredLocale) {
		log(
			`Preferred locale ${preferredLocale} is not available for TTS. Falling back to ${selectedModel.locale}. ` +
				`Install language pack extension: ${SPEECH_LANGUAGE_PACK_EXTENSION_PREFIX}${preferredLocale.toLowerCase()}.`
		);
	}

	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(selectedModel.modelPath));
	} catch {
		throw new Error(`Synthesizer model directory not found: ${selectedModel.modelPath}`);
	}

	const requireFromCurrentFile = createRequire(__filename);
	let nodeSpeech: NodeSpeechModule;
	try {
		nodeSpeech = requireFromCurrentFile(
			path.join(speechExtensionPath, 'node_modules', '@vscode', 'node-speech')
		) as NodeSpeechModule;
	} catch (error) {
		throw new Error(
			`Failed to load @vscode/node-speech from VS Code Speech extension: ${formatError(error)}.`
		);
	}

	const runtime: NodeSpeechSynthesizerRuntime = {
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
	log(`Using TTS locale: ${runtime.locale}`);
	log(`Using TTS model: ${runtime.modelName}`);
	log(`TTS model path: ${runtime.modelPath}`);

	return new NodeSpeechTtsBackend(runtime, log);
}

export function deriveNodeSpeechSynthesizerModelName(distCode: string): string {
	const modelMatch = distCode.match(
		/modelName:\"([^\"]+)\",modelPath:\(0,[^)]+\)\(__dirname,\"\.\.\",\"assets\",\"tts\"\)/
	);
	return modelMatch?.[1] ?? NODE_SPEECH_DEFAULT_SYNTHESIZER_MODEL_NAME;
}

function createAbortError(): Error {
	const error = new Error('Processing aborted.');
	error.name = 'AbortError';
	return error;
}
