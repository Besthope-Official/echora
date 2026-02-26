import * as path from 'path';
import * as vscode from 'vscode';
import type { NodeSpeechModel } from '../../types/nodeSpeech';
import { NODE_SPEECH_DEFAULT_LOCALE, normalizeLocale } from './locale';

export const SPEECH_LANGUAGE_PACK_EXTENSION_PREFIX = 'ms-vscode.vscode-speech-language-pack-';

export function discoverSpeechModels(
	speechExtensionPath: string,
	speechExtensionId: string,
	defaultModelName: string
): NodeSpeechModel[] {
	const models = new Map<string, NodeSpeechModel>();
	const normalizedSpeechExtensionId = speechExtensionId.toLowerCase();
	const defaultModel: NodeSpeechModel = {
		locale: NODE_SPEECH_DEFAULT_LOCALE,
		modelName: defaultModelName,
		modelPath: path.join(speechExtensionPath, 'assets', 'stt'),
		sourceExtensionId: speechExtensionId,
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
			const model = toNodeSpeechModel(item, extension.extensionPath, extension.id);
			if (!model) {
				continue;
			}
			models.set(model.locale.toLowerCase(), model);
		}
	}

	return Array.from(models.values());
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

function toNodeSpeechModel(
	item: unknown,
	extensionPath: string,
	sourceExtensionId: string
): NodeSpeechModel | undefined {
	if (!item || typeof item !== 'object') {
		return undefined;
	}
	const record = item as Record<string, unknown>;
	const rawLocale = typeof record.locale === 'string' ? record.locale : undefined;
	const modelName = typeof record.modelName === 'string' ? record.modelName : undefined;
	const modelPath = typeof record.modelPath === 'string' ? record.modelPath : undefined;
	if (!rawLocale || !modelName || !modelPath) {
		return undefined;
	}

	const locale = normalizeLocale(rawLocale) ?? rawLocale;
	return {
		locale,
		modelName,
		modelPath: path.join(extensionPath, modelPath),
		sourceExtensionId,
		version: typeof record.version === 'string' ? record.version : undefined,
	};
}
