import assert from 'assert/strict';
import type { NodeSpeechModel } from '../../../../src/types/nodeSpeech';
import { selectSpeechModel } from '../../../../src/core/stt/modelDiscovery';

function buildModel(locale: string): NodeSpeechModel {
	return {
		locale,
		modelName: `model-${locale}`,
		modelPath: `/tmp/${locale}`,
		sourceExtensionId: 'ms-vscode.vscode-speech',
	};
}

suite('core/stt/modelDiscovery.selectSpeechModel', () => {
	test('returns exact locale match first', () => {
		const models = [buildModel('en-US'), buildModel('zh-CN')];
		const selected = selectSpeechModel(models, 'zh-CN');
		assert.equal(selected.locale, 'zh-CN');
	});

	test('falls back to same language when exact locale is missing', () => {
		const models = [buildModel('en-US'), buildModel('zh-CN')];
		const selected = selectSpeechModel(models, 'zh-HK');
		assert.equal(selected.locale, 'zh-CN');
	});

	test('falls back to default locale when preferred language is unavailable', () => {
		const models = [buildModel('en-US'), buildModel('zh-CN')];
		const selected = selectSpeechModel(models, 'fr-FR');
		assert.equal(selected.locale, 'en-US');
	});

	test('throws when no model is available', () => {
		assert.throws(() => selectSpeechModel([], 'zh-CN'), /No speech model discovered/);
	});
});
