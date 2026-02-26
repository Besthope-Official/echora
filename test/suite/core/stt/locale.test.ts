import assert from 'assert/strict';
import { normalizeLocale } from '../../../../src/core/stt/locale';

suite('core/stt/locale', () => {
	test('returns undefined for empty input', () => {
		assert.equal(normalizeLocale(undefined), undefined);
		assert.equal(normalizeLocale(''), undefined);
		assert.equal(normalizeLocale('   '), undefined);
	});

	test('normalizes common zh variants to zh-CN', () => {
		assert.equal(normalizeLocale('zh'), 'zh-CN');
		assert.equal(normalizeLocale('zh_cn'), 'zh-CN');
		assert.equal(normalizeLocale('zh-Hans'), 'zh-CN');
		assert.equal(normalizeLocale('zh-hans-cn'), 'zh-CN');
	});

	test('normalizes en to en-US', () => {
		assert.equal(normalizeLocale('en'), 'en-US');
	});

	test('normalizes case and underscore format', () => {
		assert.equal(normalizeLocale('fr-ca'), 'fr-CA');
		assert.equal(normalizeLocale('EN_us'), 'en-US');
	});
});
