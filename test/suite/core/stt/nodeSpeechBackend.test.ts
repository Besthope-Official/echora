import assert from 'assert/strict';
import type { NodeSpeechModel } from '../../../../src/types/nodeSpeech';
import {
	deriveNodeSpeechModelKey,
	deriveNodeSpeechModelName,
	ensureSpeechExtensionTargetCompatibility,
	getRuntimeTarget,
	parseSpeechExtensionTarget,
	selectSpeechModel,
} from '../../../../src/core/stt/nodeSpeechBackend';

// ── Model key ────────────────────────────────────────────────────────

suite('nodeSpeechBackend/modelKey', () => {
	test('extracts model name from extension dist code', () => {
		const distCode =
			'modelName:"Microsoft Speech Recognizer zh-CN FP Model V9",modelPath:(0,a.b)(__dirname,"..","assets","stt")';
		assert.equal(
			deriveNodeSpeechModelName(distCode),
			'Microsoft Speech Recognizer zh-CN FP Model V9'
		);
	});

	test('uses default model name when dist code pattern is absent', () => {
		assert.equal(
			deriveNodeSpeechModelName('const nothingUseful = true;'),
			'Microsoft Speech Recognizer en-US FP Model V9'
		);
	});

	test('throws when license text is missing while deriving model key', () => {
		assert.throws(
			() => deriveNodeSpeechModelKey('const payload = "missing-license";'),
			/Unable to parse VS Code Speech license text/
		);
	});

	test('throws when encrypted payload is missing while deriving model key', () => {
		const distCode = '"You may only use the C/C++ Extension for testing"';
		assert.throws(
			() => deriveNodeSpeechModelKey(distCode),
			/Unable to parse encrypted model key payload/
		);
	});
});

// ── Platform ─────────────────────────────────────────────────────────

suite('nodeSpeechBackend/platform', () => {
	test('parses target from extension folder name', () => {
		const parsed = parseSpeechExtensionTarget('ms-vscode.vscode-speech-0.16.0-win32-x64');
		assert.equal(parsed, 'win32-x64');
	});

	test('returns undefined when target suffix is absent', () => {
		assert.equal(parseSpeechExtensionTarget('ms-vscode.vscode-speech-0.16.0'), undefined);
	});

	test('returns runtime target in platform-arch format', () => {
		const runtimeTarget = getRuntimeTarget();
		assert.match(runtimeTarget, /^[a-z0-9]+-[a-z0-9]+$/i);
	});

	test('does not throw when extension path has no parseable target suffix', () => {
		assert.doesNotThrow(() =>
			ensureSpeechExtensionTargetCompatibility('/tmp/ms-vscode.vscode-speech-dev')
		);
	});

	test('throws when extension target mismatches runtime target', () => {
		const runtimeTarget = getRuntimeTarget();
		const mismatchTarget = runtimeTarget === 'win32-x64' ? 'linux-x64' : 'win32-x64';
		assert.throws(
			() =>
				ensureSpeechExtensionTargetCompatibility(
					`/tmp/ms-vscode.vscode-speech-0.16.0-${mismatchTarget}`
				),
			/Incompatible VS Code Speech build selected/
		);
	});
});

// ── Model discovery (selectSpeechModel) ──────────────────────────────

function buildModel(locale: string): NodeSpeechModel {
	return {
		locale,
		modelName: `model-${locale}`,
		modelPath: `/tmp/${locale}`,
		sourceExtensionId: 'ms-vscode.vscode-speech',
	};
}

suite('nodeSpeechBackend/selectSpeechModel', () => {
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
