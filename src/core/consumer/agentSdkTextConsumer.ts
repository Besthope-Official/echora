import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { pathToFileURL } from 'url';
import type { PipelineTextMessage } from '../../types/pipeline';
import { formatError } from '../../utils/errors';
import { logWithScope } from '../../utils/outputLogger';
import type { ConsumerMessage, TextConsumer, TextConsumerOptions } from './types';
import { buildPromptWithSystem, buildUserPromptWithEditorContext } from './promptLoader';

type AgentSdkQueryOptions = {
	cwd?: string;
	includePartialMessages?: boolean;
	env?: Record<string, string | undefined>;
	executable?: 'node' | 'bun' | 'deno';
	pathToClaudeCodeExecutable?: string;
	settingSources?: AgentSdkSettingSource[];
	stderr?: (data: string) => void;
	spawnClaudeCodeProcess?: (options: AgentSdkSpawnOptions) => AgentSdkSpawnedProcess;
	resume?: string;
};

type AgentSdkSettingSource = 'user' | 'project' | 'local';

export type AgentSdkSpawnOptions = {
	command: string;
	args: string[];
	cwd?: string;
	env: Record<string, string | undefined>;
	signal: AbortSignal;
};

export type AgentSdkSpawnedProcess = {
	stdin: NodeJS.WritableStream;
	stdout: NodeJS.ReadableStream;
	readonly killed: boolean;
	readonly exitCode: number | null;
	kill(signal: NodeJS.Signals): boolean;
	on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
	on(event: 'error', listener: (error: Error) => void): void;
	once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
	once(event: 'error', listener: (error: Error) => void): void;
	off(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
	off(event: 'error', listener: (error: Error) => void): void;
};

type AgentSdkQueryParams = {
	prompt: string;
	abortController?: AbortController;
	options?: AgentSdkQueryOptions;
};

type AgentSdkAssistantContentBlock = {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
};

type AgentSdkAssistantMessage = {
	id?: unknown;
	content?: unknown;
};

type AgentSdkStreamMessage = {
	type?: unknown;
	subtype?: unknown;
	message?: AgentSdkAssistantMessage;
	errors?: unknown;
	error?: unknown;
	output?: unknown;
};

type AgentSdkQueryFn = (params: AgentSdkQueryParams) => AsyncIterable<AgentSdkStreamMessage>;

type AgentSdkModule = {
	query?: unknown;
};

const AGENT_SDK_PACKAGE_NAME = ['@anthropic-ai', 'claude-agent-sdk'].join('/');

export class AgentSdkTextConsumer implements TextConsumer, vscode.Disposable {
	private queryPromise: Promise<AgentSdkQueryFn> | undefined;
	private readonly _onMessage = new vscode.EventEmitter<ConsumerMessage>();
	public readonly onMessage = this._onMessage.event;

	constructor(
		private readonly resolveWorkingDirectory: () => string | undefined,
		private readonly extensionPath: string,
		private readonly getSystemPrompt: () => string,
		private readonly spawnClaudeCodeProcess?: (
			options: AgentSdkSpawnOptions,
			onStderr: (line: string) => void
		) => AgentSdkSpawnedProcess,
		private readonly getResumeSessionId: () => string | undefined = () => undefined,
		private readonly onSessionIdCaptured?: (id: string) => void,
	) {}

	public async consume(
		message: PipelineTextMessage,
		options?: TextConsumerOptions
	): Promise<void> {
		const query = await this.loadQueryFn();
		const abortController = new AbortController();
		const externalSignal = options?.signal;
		const cleanupAbortBridge = this.bridgeAbortSignals(externalSignal, abortController);
		const cwd = this.resolveWorkingDirectory() ?? getDefaultWorkingDirectory();
		const sdkCliPath = this.resolveSdkCliEntryPath();
		const stderrLines: string[] = [];
		const onStderr = (data: string): void => {
			for (const line of data
				.split(/\r?\n/u)
				.map((item) => item.trim())
				.filter((item) => item.length > 0)) {
				this.log(`sdk(stderr): ${line}`);
				stderrLines.push(line);
				if (stderrLines.length > 30) {
					stderrLines.shift();
				}
			}
		};

		this.log(`received from ${message.source}: ${message.text}`);
		this.log(`dispatching to Agent SDK. cwd=${cwd}`);
		this._onMessage.fire({ type: 'userMessage', text: message.text });
		this.log(`ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? '(not set)'}`);
		this.log(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? '***set***' : '(not set)'}`);
		if (sdkCliPath) {
			this.log(`using Claude executable path from SDK package: ${sdkCliPath}`);
		}

		let accumulatedAssistantText = '';
		let latestAssistantMessageId: string | undefined;
		let latestAssistantSnapshot = '';
		let latestThinkingSnapshot = '';
		let capturedSessionId: string | undefined;
		const firedToolUseIds = new Set<string>();

		const spawner = this.spawnClaudeCodeProcess;
		const resumeSessionId = options?.resumeSessionId ?? this.getResumeSessionId();
		const shouldInjectSystemPrompt = !resumeSessionId;
		const userPrompt = buildUserPromptWithEditorContext(message.text, message.context);
		const finalPrompt = shouldInjectSystemPrompt
			? buildPromptWithSystem(this.getSystemPrompt(), userPrompt)
			: userPrompt;
		if (message.context) {
			this.log(
				`editor_context attached: ${message.context.filePath} ${formatSelectionRange(
					message.context
				)}, selectedChars=${message.context.selectedText.length}.`
			);
		}
		this.log(
			shouldInjectSystemPrompt
				? 'injecting Echora system prompt for a new Claude session.'
				: `reusing Claude session ${resumeSessionId}; sending user text without re-injecting system prompt.`
		);

		try {
			for await (const streamMessage of query({
				prompt: finalPrompt,
				abortController,
				options: {
						cwd,
						includePartialMessages: true,
						env: buildAgentEnvironment(),
						executable: 'node',
						pathToClaudeCodeExecutable: sdkCliPath,
						settingSources: ['user', 'project', 'local'],
						stderr: onStderr,
						resume: resumeSessionId,
						spawnClaudeCodeProcess: spawner
						? (spawnOptions) => spawner(spawnOptions, onStderr)
						: undefined,
				},
			})) {
				if (!capturedSessionId) {
					const sid = (streamMessage as { session_id?: unknown }).session_id;
					if (typeof sid === 'string') {
						capturedSessionId = sid;
						this.onSessionIdCaptured?.(sid);
						this._onMessage.fire({ type: 'sessionCreated', sessionId: sid });
					}
				}
				if (isResultError(streamMessage)) {
					throw new Error(buildResultErrorMessage(streamMessage, stderrLines));
				}

				if (streamMessage.type === 'tool_progress') {
					this.handleToolProgress(streamMessage);
					continue;
				}
				if (streamMessage.type === 'tool_use_summary') {
					this.handleToolUseSummary(streamMessage);
					continue;
				}
				if (streamMessage.type === 'user') {
					this.handleSdkUserMessage(streamMessage);
					continue;
				}
				if (streamMessage.type === 'system') {
					this.handleSdkSystemMessage(streamMessage);
					continue;
				}
				if (streamMessage.type === 'auth_status') {
					if (typeof streamMessage.error === 'string') {
						this.log(`auth_status error: ${streamMessage.error}`);
					}
					continue;
				}
				if (streamMessage.type !== 'assistant') {
					continue;
				}

				const assistantMessageId = extractAssistantMessageId(streamMessage);
				if (assistantMessageId && assistantMessageId !== latestAssistantMessageId) {
					latestAssistantMessageId = assistantMessageId;
					latestAssistantSnapshot = '';
					latestThinkingSnapshot = '';
				}

				for (const block of extractToolUseBlocks(streamMessage)) {
					if (!firedToolUseIds.has(block.toolUseId)) {
						firedToolUseIds.add(block.toolUseId);
						this._onMessage.fire({ type: 'toolUse', ...block });
					}
				}

				const nextThinkingSnapshot = extractAssistantThinking(streamMessage);
				const thinkingDelta = computeTextDelta(latestThinkingSnapshot, nextThinkingSnapshot);
				latestThinkingSnapshot = nextThinkingSnapshot;
				if (thinkingDelta) {
					this.log(`assistant(thinking-delta): ${thinkingDelta}`);
					this._onMessage.fire({ type: 'assistantThinkingDelta', text: thinkingDelta });
				}

				const nextAssistantSnapshot = extractAssistantText(streamMessage);
				const delta = computeTextDelta(latestAssistantSnapshot, nextAssistantSnapshot);
				latestAssistantSnapshot = nextAssistantSnapshot;
				if (!delta) {
					continue;
				}

				accumulatedAssistantText += delta;
				this.log(`assistant(delta): ${delta}`);
				this._onMessage.fire({ type: 'assistantDelta', text: delta });
			}
		} catch (error) {
			if (externalSignal?.aborted || isAbortError(error)) {
				throw createAbortError();
			}
			const errorMessage = `Agent SDK consume failed: ${formatError(error)}${formatStderrSuffix(stderrLines)}`;
			this._onMessage.fire({ type: 'error', message: errorMessage });
			throw new Error(errorMessage);
		} finally {
			cleanupAbortBridge();
		}

		const finalText = accumulatedAssistantText.trim();
		if (finalText) {
			this.log(`assistant(final): ${finalText}`);
			this._onMessage.fire({ type: 'assistantDone', text: finalText });
			return;
		}
		this.log('assistant(final): [empty response]');
	}

	public dispose(): void {
		this._onMessage.dispose();
	}

	private handleToolProgress(streamMessage: AgentSdkStreamMessage): void {
		const msg = streamMessage as unknown as {
			tool_use_id?: unknown; tool_name?: unknown; elapsed_time_seconds?: unknown;
		};
		if (typeof msg.tool_use_id !== 'string' || typeof msg.tool_name !== 'string') {
			return;
		}
		const elapsedSeconds = Number(msg.elapsed_time_seconds) || 0;
		this.log(`tool_progress: ${msg.tool_name} (${elapsedSeconds.toFixed(1)}s)`);
		this._onMessage.fire({ type: 'toolProgress', toolUseId: msg.tool_use_id, toolName: msg.tool_name, elapsedSeconds });
	}

	private handleToolUseSummary(streamMessage: AgentSdkStreamMessage): void {
		const msg = streamMessage as unknown as { summary?: unknown };
		if (typeof msg.summary === 'string') {
			this.log(`tool_use_summary: ${msg.summary}`);
			this._onMessage.fire({ type: 'toolUseSummary', summary: msg.summary });
		}
	}

	private handleSdkUserMessage(streamMessage: AgentSdkStreamMessage): void {
		const msg = streamMessage as unknown as {
			isSynthetic?: boolean;
			message?: { content?: unknown };
		};
		if (msg.isSynthetic) {
			return;
		}
		const content = msg.message?.content;
		if (!Array.isArray(content)) {
			return;
		}
		for (const block of content) {
			if (!block || typeof block !== 'object') {
				continue;
			}
			const b = block as { type?: unknown; tool_use_id?: unknown; content?: unknown; is_error?: unknown };
			if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') {
				continue;
			}
			this._onMessage.fire({
				type: 'toolResult',
				toolUseId: b.tool_use_id,
				isError: b.is_error === true,
				content: formatToolResultContent(b.content),
			});
		}
	}

	private handleSdkSystemMessage(streamMessage: AgentSdkStreamMessage): void {
		const msg = streamMessage as unknown as { subtype?: unknown; [key: string]: unknown };
		const subtype = msg.subtype;
		if (subtype === 'init') {
			this.log(`system/init: model=${String(msg.model)}, tools=${JSON.stringify(msg.tools)}`);
		} else if (subtype === 'task_started') {
			const taskId = msg.task_id;
			const description = msg.description;
			if (typeof taskId === 'string' && typeof description === 'string') {
				this.log(`task_started: ${description}`);
				this._onMessage.fire({ type: 'taskStarted', taskId, description });
			}
		} else if (subtype === 'task_progress') {
			const taskId = msg.task_id;
			const description = msg.description;
			const lastToolName = msg.last_tool_name;
			if (typeof taskId === 'string' && typeof description === 'string') {
				this._onMessage.fire({
					type: 'taskProgress',
					taskId,
					description,
					lastToolName: typeof lastToolName === 'string' ? lastToolName : undefined,
				});
			}
		} else if (subtype === 'task_notification') {
			const summary = msg.summary;
			if (typeof summary === 'string') {
				this.log(`task_notification: ${summary}`);
			}
		} else if (subtype === 'status' && msg.status) {
			this.log(`system/status: ${String(msg.status)}`);
		} else if (subtype === 'compact_boundary') {
			this.log('system/compact_boundary');
		}
	}

	private async loadQueryFn(): Promise<AgentSdkQueryFn> {
		if (!this.queryPromise) {
			this.queryPromise = this.resolveQueryFn();
		}
		return this.queryPromise;
	}

	private async resolveQueryFn(): Promise<AgentSdkQueryFn> {
		const sdkModule = (await this.loadAgentSdkModule()) as AgentSdkModule;
		if (typeof sdkModule.query !== 'function') {
			throw new Error(
				`Loaded ${AGENT_SDK_PACKAGE_NAME} but did not find query(). Check SDK version compatibility.`
			);
		}
		return sdkModule.query as AgentSdkQueryFn;
	}

	private async loadAgentSdkModule(): Promise<unknown> {
		const dynamicImport = new Function(
			'moduleName',
			'return import(moduleName);'
		) as (moduleName: string) => Promise<unknown>;
		const requireFromCurrentFile = createRequire(__filename);
		try {
			return requireFromCurrentFile(AGENT_SDK_PACKAGE_NAME) as unknown;
		} catch (error) {
			const errorCode = getErrorCode(error);
			if (errorCode !== 'ERR_REQUIRE_ESM' && errorCode !== 'MODULE_NOT_FOUND') {
				throw new Error(`Failed to load ${AGENT_SDK_PACKAGE_NAME}: ${formatError(error)}`);
			}
		}

		try {
			return await dynamicImport(AGENT_SDK_PACKAGE_NAME);
		} catch (error) {
			const moduleEntryPath = this.resolveSdkModuleEntryPath();
			if (moduleEntryPath) {
				this.log(`fallback loading SDK via absolute path: ${moduleEntryPath}`);
				try {
					return await dynamicImport(pathToFileURL(moduleEntryPath).href);
				} catch (fallbackError) {
					throw new Error(
						`Unable to load ${AGENT_SDK_PACKAGE_NAME} from package name or absolute path. ` +
							`package import error=(${formatError(error)}); absolute path error=(${formatError(
								fallbackError
							)})`
					);
				}
			}
			throw new Error(
				`Unable to load ${AGENT_SDK_PACKAGE_NAME}. Install it in the extension runtime ` +
					`and make sure Claude Code authentication is configured. (${formatError(error)}). ` +
					`No SDK entry found under extension path: ${this.extensionPath}`
			);
		}
	}

	private bridgeAbortSignals(
		externalSignal: AbortSignal | undefined,
		abortController: AbortController
	): () => void {
		if (!externalSignal) {
			return () => undefined;
		}
		const onAbort = () => abortController.abort();
		if (externalSignal.aborted) {
			abortController.abort();
			return () => undefined;
		}
		externalSignal.addEventListener('abort', onAbort, { once: true });
		return () => externalSignal.removeEventListener('abort', onAbort);
	}

	private log(message: string): void {
		logWithScope('AgentSdkTextConsumer', message);
	}

	private resolveSdkModuleEntryPath(): string | undefined {
		const directEntry = path.join(
			this.extensionPath,
			'node_modules',
			'@anthropic-ai',
			'claude-agent-sdk',
			'sdk.mjs'
		);
		if (isExistingFile(directEntry)) {
			return directEntry;
		}

		const pnpmStorePath = path.join(this.extensionPath, 'node_modules', '.pnpm');
		let pnpmDirectories: string[];
		try {
			pnpmDirectories = fs.readdirSync(pnpmStorePath);
		} catch {
			return undefined;
		}

		const sdkEntries = pnpmDirectories
			.filter((name) => name.startsWith('@anthropic-ai+claude-agent-sdk@'))
			.sort((left, right) => right.localeCompare(left))
			.map((name) =>
				path.join(
					pnpmStorePath,
					name,
					'node_modules',
					'@anthropic-ai',
					'claude-agent-sdk',
					'sdk.mjs'
				)
			);

		for (const entry of sdkEntries) {
			if (isExistingFile(entry)) {
				return entry;
			}
		}
		return undefined;
	}

	private resolveSdkCliEntryPath(): string | undefined {
		const directEntry = path.join(
			this.extensionPath,
			'node_modules',
			'@anthropic-ai',
			'claude-agent-sdk',
			'cli.js'
		);
		if (isExistingFile(directEntry)) {
			return directEntry;
		}

		const pnpmStorePath = path.join(this.extensionPath, 'node_modules', '.pnpm');
		let pnpmDirectories: string[];
		try {
			pnpmDirectories = fs.readdirSync(pnpmStorePath);
		} catch {
			return undefined;
		}

		const cliEntries = pnpmDirectories
			.filter((name) => name.startsWith('@anthropic-ai+claude-agent-sdk@'))
			.sort((left, right) => right.localeCompare(left))
			.map((name) =>
				path.join(
					pnpmStorePath,
					name,
					'node_modules',
					'@anthropic-ai',
					'claude-agent-sdk',
					'cli.js'
				)
			);

		for (const entry of cliEntries) {
			if (isExistingFile(entry)) {
				return entry;
			}
		}
		return undefined;
	}
}

export function extractAssistantText(streamMessage: AgentSdkStreamMessage): string {
	const content = streamMessage.message?.content;
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return '';
	}

	let text = '';
	for (const block of content) {
		if (!block || typeof block !== 'object') {
			continue;
		}
		const candidate = block as AgentSdkAssistantContentBlock;
		if (candidate.type === 'text' && typeof candidate.text === 'string') {
			text += candidate.text;
		}
	}
	return text;
}

export function extractAssistantThinking(streamMessage: AgentSdkStreamMessage): string {
	const content = streamMessage.message?.content;
	if (!Array.isArray(content)) {
		return '';
	}

	let text = '';
	for (const block of content) {
		if (!block || typeof block !== 'object') {
			continue;
		}
		const candidate = block as AgentSdkAssistantContentBlock;
		if (candidate.type === 'thinking' && typeof candidate.thinking === 'string') {
			text += candidate.thinking;
		}
	}
	return text;
}

export function computeTextDelta(previous: string, next: string): string {
	if (!next) {
		return '';
	}
	if (!previous) {
		return next;
	}
	if (next.startsWith(previous)) {
		return next.slice(previous.length);
	}
	if (previous.startsWith(next)) {
		return '';
	}

	const commonPrefixLength = findCommonPrefixLength(previous, next);
	return next.slice(commonPrefixLength);
}

function extractAssistantMessageId(streamMessage: AgentSdkStreamMessage): string | undefined {
	const id = streamMessage.message?.id;
	return typeof id === 'string' ? id : undefined;
}

function isResultError(streamMessage: AgentSdkStreamMessage): boolean {
	return streamMessage.type === 'result' && typeof streamMessage.subtype === 'string' && streamMessage.subtype.startsWith('error_');
}

function buildResultErrorMessage(streamMessage: AgentSdkStreamMessage, stderrLines: string[]): string {
	const parts = [`Agent SDK returned ${String(streamMessage.subtype)}.`];
	if (Array.isArray(streamMessage.errors) && streamMessage.errors.length > 0) {
		const normalizedErrors = streamMessage.errors
			.filter((item): item is string => typeof item === 'string')
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
		if (normalizedErrors.length > 0) {
			parts.push(`errors=${normalizedErrors.join(' | ')}`);
		}
	}
	const stderrSuffix = formatStderrSuffix(stderrLines);
	if (stderrSuffix) {
		parts.push(stderrSuffix.trim());
	}
	return parts.join(' ');
}

function getErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== 'object') {
		return undefined;
	}
	const maybeCode = (error as { code?: unknown }).code;
	return typeof maybeCode === 'string' ? maybeCode : undefined;
}

function findCommonPrefixLength(left: string, right: string): number {
	const maxLength = Math.min(left.length, right.length);
	let index = 0;
	while (index < maxLength && left.charCodeAt(index) === right.charCodeAt(index)) {
		index += 1;
	}
	return index;
}

function isAbortError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}
	const candidate = error as { name?: unknown; message?: unknown };
	return candidate.name === 'AbortError' || candidate.message === 'The operation was aborted.';
}

function createAbortError(): Error {
	const error = new Error('Processing aborted.');
	error.name = 'AbortError';
	return error;
}

function getDefaultWorkingDirectory(): string {
	try {
		const home = os.homedir();
		if (home) {
			return home;
		}
	} catch {
		// ignore and fall back to process.cwd()
	}
	return process.cwd();
}

function formatStderrSuffix(stderrLines: string[]): string {
	if (stderrLines.length === 0) {
		return '';
	}
	return ` (last stderr: ${stderrLines[stderrLines.length - 1]})`;
}

function formatSelectionRange(context: NonNullable<PipelineTextMessage['context']>): string {
	return `${context.selection.startLine + 1}:${context.selection.startCharacter + 1}-${
		context.selection.endLine + 1
	}:${context.selection.endCharacter + 1}`;
}

function buildAgentEnvironment(): Record<string, string | undefined> {
	return {
		...process.env,
		CLAUDECODE: undefined,
	};
}

function isExistingFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function extractToolUseBlocks(
	streamMessage: AgentSdkStreamMessage
): Array<{ toolUseId: string; toolName: string; inputSummary: string }> {
	const content = streamMessage.message?.content;
	if (!Array.isArray(content)) {
		return [];
	}
	const blocks: Array<{ toolUseId: string; toolName: string; inputSummary: string }> = [];
	for (const block of content) {
		if (!block || typeof block !== 'object') {
			continue;
		}
		const b = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
		if (b.type !== 'tool_use' || typeof b.id !== 'string' || typeof b.name !== 'string') {
			continue;
		}
		blocks.push({ toolUseId: b.id, toolName: b.name, inputSummary: formatToolInput(b.name, b.input) });
	}
	return blocks;
}

function formatToolInput(_name: string, input: unknown): string {
	if (!input || typeof input !== 'object') {
		return '';
	}
	const inp = input as Record<string, unknown>;
	const primaryKey = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'].find(
		(k) => typeof inp[k] === 'string'
	);
	if (primaryKey) {
		const val = inp[primaryKey] as string;
		return val.length > 60 ? `${val.slice(0, 57)}\u2026` : val;
	}
	const json = JSON.stringify(input);
	return json.length > 60 ? `${json.slice(0, 57)}\u2026` : json;
}

function formatToolResultContent(content: unknown): string {
	if (typeof content === 'string') {
		return content.slice(0, 300);
	}
	if (Array.isArray(content)) {
		return content
			.filter((b): b is { type: 'text'; text: string } =>
				b !== null && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string'
			)
			.map((b) => b.text)
			.join('\n')
			.slice(0, 300);
	}
	return '';
}
