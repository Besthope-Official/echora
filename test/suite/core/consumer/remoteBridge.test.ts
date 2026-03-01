import assert from 'assert/strict';
import { buildSshBridgeEnvironment } from '../../../../src/core/consumer/remoteBridge';

suite('remoteBridge/buildSshBridgeEnvironment', () => {
	test('forwards ANTHROPIC_API_KEY when present', () => {
		const result = buildSshBridgeEnvironment({
			ANTHROPIC_API_KEY: 'sk-test-123',
			HOME: '/home/user',
			PATH: '/usr/bin',
		});
		assert.deepEqual(result, { ANTHROPIC_API_KEY: 'sk-test-123' });
	});

	test('forwards ANTHROPIC_BASE_URL when present', () => {
		const result = buildSshBridgeEnvironment({
			ANTHROPIC_BASE_URL: 'https://custom.api.example.com',
			NODE_ENV: 'production',
		});
		assert.deepEqual(result, { ANTHROPIC_BASE_URL: 'https://custom.api.example.com' });
	});

	test('forwards both keys when both are set', () => {
		const result = buildSshBridgeEnvironment({
			ANTHROPIC_API_KEY: 'sk-key',
			ANTHROPIC_BASE_URL: 'https://api.example.com',
			OTHER_VAR: 'ignored',
		});
		assert.deepEqual(result, {
			ANTHROPIC_API_KEY: 'sk-key',
			ANTHROPIC_BASE_URL: 'https://api.example.com',
		});
	});

	test('returns empty object when neither key is set', () => {
		const result = buildSshBridgeEnvironment({
			HOME: '/home/user',
			PATH: '/usr/bin',
		});
		assert.deepEqual(result, {});
	});

	test('skips keys with undefined values', () => {
		const result = buildSshBridgeEnvironment({
			ANTHROPIC_API_KEY: undefined,
			ANTHROPIC_BASE_URL: 'https://api.example.com',
		});
		assert.deepEqual(result, { ANTHROPIC_BASE_URL: 'https://api.example.com' });
	});
});
