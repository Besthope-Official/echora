import { spawn as spawnProcess } from 'child_process';
import * as vscode from 'vscode';
import type { AgentSdkSpawnOptions, AgentSdkSpawnedProcess } from './agentSdkTextConsumer';
import { logWithScope } from '../../utils/outputLogger';

export type RemoteContext =
	| { type: 'wsl'; distroName: string }
	| { type: 'ssh'; host: string };

export function resolveRemoteContext(): RemoteContext | undefined {
	const raw = vscode.workspace
		.getConfiguration('echora')
		.get<string>('pipeline.remote', '');
	if (!raw) {
		return undefined;
	}

	const wslMatch = raw.match(/^wsl:(.+)$/i);
	if (wslMatch?.[1]) {
		return { type: 'wsl', distroName: wslMatch[1] };
	}

	const sshMatch = raw.match(/^ssh:(.+)$/i);
	if (sshMatch?.[1]) {
		return { type: 'ssh', host: sshMatch[1] };
	}

	return undefined;
}

export function resolveRemoteWorkingDirectory(
	workspaceUri: vscode.Uri | undefined,
	remoteContext: RemoteContext
): string | undefined {
	if (workspaceUri?.scheme !== 'vscode-remote') {
		return undefined;
	}

	if (remoteContext.type === 'ssh') {
		// SSH: path is already the remote filesystem path
		return workspaceUri.path.startsWith('/') ? workspaceUri.path : `/${workspaceUri.path}`;
	}
	if (remoteContext.type === 'wsl') {
		// WSL: convert to Windows UNC path for wsl.exe --cd
		const pathInWsl = workspaceUri.path.startsWith('/') ? workspaceUri.path : `/${workspaceUri.path}`;
		return `\\\\wsl$\\${remoteContext.distroName}${pathInWsl.replace(/\//g, '\\')}`;
	}

	return undefined;
}

export type RemoteSpawner = (
	spawnOptions: AgentSdkSpawnOptions,
	onStderr: (line: string) => void
) => AgentSdkSpawnedProcess;

export function createRemoteSpawner(remoteContext: RemoteContext): RemoteSpawner {
	return (spawnOptions, onStderr) => {
		if (remoteContext.type === 'wsl') {
			return spawnViaWsl(spawnOptions, onStderr, remoteContext.distroName);
		}
		return spawnViaSsh(spawnOptions, onStderr, remoteContext.host);
	};
}

function spawnViaWsl(
	spawnOptions: AgentSdkSpawnOptions,
	onStderr: (line: string) => void,
	distro: string
): AgentSdkSpawnedProcess {
	const convertedCommand = toWslPathForDistro(spawnOptions.command, distro) ?? spawnOptions.command;
	const convertedArgs = spawnOptions.args.map((arg) => toWslPathForDistro(arg, distro) ?? arg);
	const convertedCwd = spawnOptions.cwd ? toWslPathForDistro(spawnOptions.cwd, distro) : undefined;
	const innerCommand =
		'[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" 2>/dev/null; '
		+ 'exec '
		+ shellEscapeForBash([convertedCommand, ...convertedArgs]);
	const wslArgs = ['-d', distro];
	if (convertedCwd) {
		wslArgs.push('--cd', convertedCwd);
	}
	wslArgs.push('--', 'bash', '-lc', innerCommand);
	log(`spawn via wsl.exe: ${wslArgs.join(' ')}`);

	const child = spawnProcess('wsl.exe', wslArgs, {
		cwd: undefined,
		env: buildWslBridgeEnvironment(spawnOptions.env),
		stdio: ['pipe', 'pipe', 'pipe'],
		signal: spawnOptions.signal,
		windowsHide: true,
	});

	return wrapChildProcess(child, onStderr);
}

function spawnViaSsh(
	spawnOptions: AgentSdkSpawnOptions,
	onStderr: (line: string) => void,
	host: string
): AgentSdkSpawnedProcess {
	const envVars = buildSshBridgeEnvironment(spawnOptions.env);
	const envPrefix = Object.entries(envVars)
		.map(([key, value]) => `${key}=${shellEscapeForBash([value])}`)
		.join(' ');

	const commandWithArgs = shellEscapeForBash([spawnOptions.command, ...spawnOptions.args]);
	const cdCommand = spawnOptions.cwd ? `cd ${shellEscapeForBash([spawnOptions.cwd])} && ` : '';
	const innerCommand =
		'[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" 2>/dev/null; '
		+ cdCommand
		+ (envPrefix ? `${envPrefix} ` : '')
		+ `exec ${commandWithArgs}`;

	const sshArgs = [host, '--', 'bash', '-lc', innerCommand];
	log(`spawn via ssh: ssh ${sshArgs.join(' ')}`);

	const child = spawnProcess('ssh', sshArgs, {
		cwd: undefined,
		env: process.env as Record<string, string>,
		stdio: ['pipe', 'pipe', 'pipe'],
		signal: spawnOptions.signal,
	});

	return wrapChildProcess(child, onStderr);
}

function wrapChildProcess(
	child: ReturnType<typeof spawnProcess>,
	onStderr: (line: string) => void
): AgentSdkSpawnedProcess {
	child.stderr?.on('data', (chunk: Buffer | string) => {
		onStderr(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
	});

	if (!child.stdin || !child.stdout) {
		throw new Error('Failed to create stdio pipes for bridged process.');
	}

	return {
		stdin: child.stdin,
		stdout: child.stdout,
		get killed() {
			return child.killed;
		},
		get exitCode() {
			return child.exitCode;
		},
		kill(signal: NodeJS.Signals): boolean {
			return child.kill(signal);
		},
		on(event: 'exit' | 'error', listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void)): void {
			child.on(event, listener as never);
		},
		once(event: 'exit' | 'error', listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void)): void {
			child.once(event, listener as never);
		},
		off(event: 'exit' | 'error', listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void)): void {
			child.off(event, listener as never);
		},
	};
}

function buildWslBridgeEnvironment(
	baseEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		if (/^PATH$/i.test(key)) {
			continue;
		}
		env[key] = value;
	}
	env['WSLENV'] = undefined;
	return env;
}

export function buildSshBridgeEnvironment(
	baseEnv: Record<string, string | undefined>
): Record<string, string> {
	const forwarded: Record<string, string> = {};
	for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']) {
		const value = baseEnv[key];
		if (value) {
			forwarded[key] = value;
		}
	}
	return forwarded;
}

function toWslPathForDistro(input: string, distro: string): string | undefined {
	const normalized = input.replace(/\//g, '\\');
	const uncPrefix = `\\\\wsl$\\${distro}\\`;
	const uncLocalhostPrefix = `\\\\wsl.localhost\\${distro}\\`;
	if (normalized.toLowerCase().startsWith(uncPrefix.toLowerCase())) {
		const tail = normalized.slice(uncPrefix.length).replace(/\\/g, '/');
		return `/${tail}`;
	}
	if (normalized.toLowerCase().startsWith(uncLocalhostPrefix.toLowerCase())) {
		const tail = normalized.slice(uncLocalhostPrefix.length).replace(/\\/g, '/');
		return `/${tail}`;
	}

	const fileUrlPrefix = `file://wsl$/${distro}/`;
	const fileUrlLocalhostPrefix = `file://wsl.localhost/${distro}/`;
	if (input.toLowerCase().startsWith(fileUrlPrefix.toLowerCase())) {
		const tail = input.slice(fileUrlPrefix.length);
		return `/${decodeURIComponent(tail)}`;
	}
	if (input.toLowerCase().startsWith(fileUrlLocalhostPrefix.toLowerCase())) {
		const tail = input.slice(fileUrlLocalhostPrefix.length);
		return `/${decodeURIComponent(tail)}`;
	}
	return undefined;
}

function shellEscapeForBash(args: string[]): string {
	return args.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
}

function log(message: string): void {
	logWithScope('remoteBridge', message);
}
