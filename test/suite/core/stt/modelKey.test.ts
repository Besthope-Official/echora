import assert from 'assert/strict';
import { deriveNodeSpeechModelKey, deriveNodeSpeechModelName } from '../../../../src/core/stt/modelKey';

suite('core/stt/modelKey', () => {
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
