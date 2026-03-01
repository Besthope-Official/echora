import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const DEFAULT_ECHORA_SYSTEM_PROMPT = `You are responding to voice input via Echora. The user is coding hands-free.

Response style:
- Skip all filler openings ("Sure!", "Of course!", "Certainly!", "Great question!")
- After making code changes, confirm in one sentence what changed — no step-by-step recap
- For purely mechanical tasks (rename, format, delete, add import), do it and say "Done" or one short sentence
- Prefer plain prose over markdown headers and nested lists in explanations
- Keep responses under 3 sentences unless the user asks for detail
- If you need clarification, ask exactly one direct question`;

/**
 * Resolves the system prompt to use for the voice pipeline.
 *
 * Resolution order (first match wins):
 * 1. File at path specified by `echora.pipeline.systemPromptFile` setting
 * 2. Auto-detected `.echora/prompt.md` in workspace root
 * 3. Inline `echora.pipeline.systemPrompt` setting
 * 4. Built-in default
 */
export function loadSystemPrompt(workspaceRoot: string | undefined): string {
	const config = vscode.workspace.getConfiguration('echora');

	const promptFile = config.get<string>('pipeline.systemPromptFile', '').trim();
	if (promptFile) {
		const resolved = path.isAbsolute(promptFile)
			? promptFile
			: workspaceRoot
			? path.join(workspaceRoot, promptFile)
			: promptFile;
		const content = tryReadFile(resolved);
		if (content !== undefined) {
			return content;
		}
	}

	if (workspaceRoot) {
		const autoPath = path.join(workspaceRoot, '.echora', 'prompt.md');
		const content = tryReadFile(autoPath);
		if (content !== undefined) {
			return content;
		}
	}

	const inlinePrompt = config.get<string>('pipeline.systemPrompt', '').trim();
	if (inlinePrompt) {
		return inlinePrompt;
	}

	return DEFAULT_ECHORA_SYSTEM_PROMPT;
}

export function buildPromptWithSystem(systemPrompt: string, userText: string): string {
	return `<echora_instructions>\n${systemPrompt}\n</echora_instructions>\n\n${userText}`;
}

function tryReadFile(filePath: string): string | undefined {
	try {
		const content = fs.readFileSync(filePath, 'utf-8').trim();
		return content.length > 0 ? content : undefined;
	} catch {
		return undefined;
	}
}
