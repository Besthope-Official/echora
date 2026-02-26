import assert from 'assert/strict';
import { formatError } from '../../../src/utils/errors';

suite('utils/errors.formatError', () => {
	test('returns message for Error instance', () => {
		assert.equal(formatError(new Error('boom')), 'boom');
	});

	test('stringifies non-Error values', () => {
		assert.equal(formatError('plain-text'), 'plain-text');
		assert.equal(formatError(404), '404');
	});
});
