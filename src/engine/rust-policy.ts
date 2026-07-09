import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ErrorCode, McpError as OriginalMcpError } from '@modelcontextprotocol/sdk/types.js'

const McpError = OriginalMcpError

type RustPolicyEnvelope =
	| { status: 'ok'; resolved_path: string }
	| { status: 'error'; code: string; message: string }

const here = path.dirname(fileURLToPath(import.meta.url))

export function resolveRustCliBinary(): string {
	const env = process.env['FILESYSTEM_CLI']
	if (env && existsSync(env)) {
		return env
	}

	const release = path.join(here, '../../target/release/filesystem-cli')
	if (existsSync(release)) {
		return release
	}

	const debug = path.join(here, '../../target/debug/filesystem-cli')
	if (existsSync(debug)) {
		return debug
	}

	return 'filesystem-cli'
}

export function shouldUseRustPolicyEngine(): boolean {
	return process.env['FILESYSTEM_USE_RUST_POLICY'] === '1'
}

export function resolvePathViaRustEngine(relativePath: string, rootPath: string): string {
	const binary = resolveRustCliBinary()
	const payload = JSON.stringify({
		tool: 'resolve_path',
		input: {
			relative_path: relativePath,
			root: rootPath,
		},
	})

	const result = spawnSync(binary, [], {
		input: payload,
		encoding: 'utf8',
		maxBuffer: 1024 * 1024,
	})

	if (result.error) {
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to launch filesystem policy engine: ${result.error.message}`,
		)
	}

	if (result.status !== 0) {
		throw new McpError(
			ErrorCode.InternalError,
			result.stderr || `Filesystem policy engine exited with status ${result.status}`,
		)
	}

	const envelope = JSON.parse(result.stdout) as RustPolicyEnvelope
	if (envelope.status !== 'ok') {
		const code =
			envelope.code === 'INVALID_PARAMS' ? ErrorCode.InvalidParams : ErrorCode.InvalidRequest
		throw new McpError(code, envelope.message)
	}

	return envelope.resolved_path
}
