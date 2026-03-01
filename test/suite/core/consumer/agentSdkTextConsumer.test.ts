import assert from 'assert/strict';
import { computeTextDelta, extractAssistantText } from '../../../../src/core/consumer/agentSdkTextConsumer';

suite('agentSdkTextConsumer/extractAssistantText', () => {
	test('returns empty string for non-array content', () => {
		assert.equal(
			extractAssistantText({
				type: 'assistant',
				message: { content: { type: 'text', text: 'hello' } },
			}),
			''
		);
	});

	test('concatenates only text blocks from assistant content', () => {
		assert.equal(
			extractAssistantText({
				type: 'assistant',
				message: {
					content: [
						{ type: 'text', text: 'Hello' },
						{ type: 'tool_use', name: 'bash' },
						{ type: 'text', text: ', world' },
					],
				},
			}),
			'Hello, world'
		);
	});
});

suite('agentSdkTextConsumer/computeTextDelta', () => {
	test('returns full text when previous snapshot is empty', () => {
		assert.equal(computeTextDelta('', 'hello'), 'hello');
	});

	test('returns appended segment for monotonic snapshots', () => {
		assert.equal(computeTextDelta('hello', 'hello world'), ' world');
	});

	test('returns empty string when snapshot does not grow', () => {
		assert.equal(computeTextDelta('hello world', 'hello'), '');
		assert.equal(computeTextDelta('hello', 'hello'), '');
	});

	test('falls back to common-prefix diff for divergent snapshots', () => {
		assert.equal(computeTextDelta('hello brave', 'hello world'), 'world');
	});
});
