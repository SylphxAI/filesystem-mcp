import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ErrorCode, McpError as OriginalMcpError } from '@modelcontextprotocol/sdk/types.js'
import type { FormattedStats } from '../utils/stats-utils.js'

const McpError = OriginalMcpError

export type RustListEntry = {
	path: string
	stats?: FormattedStats
}

type RustListEnvelope =
	| {
			status: 'ok'
			entries: RustListEntry[]
			metrics: { entries_found: number; elapsed_ms: number; route: string }
	  }
	| { status: 'error'; code: string; message: string }

const here = path.dirname(fileURLToPath(import.meta.url))

export function shouldUseRustWalkEngine(): boolean {
	return process.env['FILESYSTEM_USE_RUST_WALK'] === '1'
}

export function listFilesViaRustEngine(input: {
	root: string
	path: string
	recursive: boolean
	include_stats: boolean
}): RustListEnvelope {
	const binary = resolveRustCliBinary()
	const payload = JSON.stringify({
		tool: 'list_files',
		input,
	})

	const result = spawnSync(binary, [], {
		input: payload,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	})

	if (result.error) {
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to launch filesystem walk engine: ${result.error.message}`,
		)
	}

	if (result.status !== 0) {
		throw new McpError(
			ErrorCode.InternalError,
			result.stderr || `Filesystem walk engine exited with status ${result.status}`,
		)
	}

	return JSON.parse(result.stdout) as RustListEnvelope
}

function resolveRustCliBinary(): string {
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