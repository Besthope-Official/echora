import assert from 'assert/strict';
import { buildPromptWithSystem, buildUserPromptWithEditorContext } from '../../../../src/core/consumer/promptLoader';

suite('promptLoader/buildUserPromptWithEditorContext', () => {
	test('returns the user text when editor context is missing', () => {
		assert.equal(buildUserPromptWithEditorContext('Explain this function', undefined), 'Explain this function');
	});

	test('prepends editor_context block before user text', () => {
		const result = buildUserPromptWithEditorContext('What is wrong here?', {
			filePath: 'src/core/pipeline.ts',
			languageId: 'typescript',
			selection: {
				startLine: 9,
				startCharacter: 1,
				endLine: 12,
				endCharacter: 8,
				isEmpty: false,
			},
			selectedText: 'const x = 1;\nreturn x;',
		});

		assert.ok(result.includes('<editor_context>'));
		assert.ok(result.includes('file_path: src/core/pipeline.ts'));
		assert.ok(result.includes('language_id: typescript'));
		assert.ok(result.includes('selection: 10:2-13:9'));
		assert.ok(result.includes('selection_is_empty: false'));
		assert.ok(result.includes('selected_text:\nconst x = 1;\nreturn x;'));
		assert.ok(result.endsWith('\n\nWhat is wrong here?'));
	});

	test('marks empty selection explicitly', () => {
		const result = buildUserPromptWithEditorContext('Please explain this line', {
			filePath: 'src/extension.ts',
			languageId: 'typescript',
			selection: {
				startLine: 2,
				startCharacter: 0,
				endLine: 2,
				endCharacter: 0,
				isEmpty: true,
			},
			selectedText: '',
		});

		assert.ok(result.includes('selected_text:\n[empty selection]'));
	});
});

suite('promptLoader/buildPromptWithSystem', () => {
	test('wraps user prompt with echora instructions block', () => {
		assert.equal(
			buildPromptWithSystem('Be concise', 'What is this code doing?'),
			'<echora_instructions>\nBe concise\n</echora_instructions>\n\nWhat is this code doing?'
		);
	});
});
