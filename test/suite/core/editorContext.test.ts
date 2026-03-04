import assert from 'assert/strict';
import { shouldAttachEditorContext } from '../../../src/core/editorContext';

suite('core/editorContext', () => {
	test('returns false when selection is empty', () => {
		assert.equal(shouldAttachEditorContext({ isEmpty: true }), false);
	});

	test('returns true when selection has content', () => {
		assert.equal(shouldAttachEditorContext({ isEmpty: false }), true);
	});
});
