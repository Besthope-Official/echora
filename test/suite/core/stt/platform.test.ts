import assert from 'assert/strict';
import {
	ensureSpeechExtensionTargetCompatibility,
	getRuntimeTarget,
	parseSpeechExtensionTarget,
} from '../../../../src/core/stt/platform';

suite('core/stt/platform', () => {
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
		assert.doesNotThrow(() => ensureSpeechExtensionTargetCompatibility('/tmp/ms-vscode.vscode-speech-dev'));
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
