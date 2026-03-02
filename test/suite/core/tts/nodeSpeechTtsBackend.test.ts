import assert from 'assert/strict';
import { deriveNodeSpeechSynthesizerModelName } from '../../../../src/core/tts/nodeSpeechTtsBackend';

suite('nodeSpeechTtsBackend/modelName', () => {
	test('extracts synthesizer model name from speech extension dist code', () => {
		const distCode =
			'modelName:"Microsoft Server Speech Text to Speech Voice (zh-CN, YunxiNeural)",modelPath:(0,a.b)(__dirname,"..","assets","tts")';
		assert.equal(
			deriveNodeSpeechSynthesizerModelName(distCode),
			'Microsoft Server Speech Text to Speech Voice (zh-CN, YunxiNeural)'
		);
	});

	test('falls back to default synthesizer model name when dist pattern is absent', () => {
		assert.equal(
			deriveNodeSpeechSynthesizerModelName('const noTtsModelHint = true;'),
			'Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)'
		);
	});
});
