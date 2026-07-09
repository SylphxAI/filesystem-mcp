import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ErrorCode, McpError as OriginalMcpError } from '@modelcontextprotocol/sdk/types.js'

const McpError = OriginalMcpError

type RustSearchMatch = {
	file: string
	line: number
	matched_text: string
	context: string[]
}

type RustSearchEnvelope =
	| {
			status: 'ok'
			results: RustSearchMatch[]
			metrics: {
				files_scanned: number
				matches_found: number
				elapsed_ms: number
			}
	  }
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

export function shouldUseRustSearchEngine(): boolean {
	return process.env['FILESYSTEM_USE_RUST_SEARCH'] === '1'
}

export function searchFilesViaRustEngine(input: {
	root: string
	path: string
	regex: string
	file_pattern: string
}): RustSearchEnvelope {
	const binary = resolveRustCliBinary()
	const payload = JSON.stringify({
		tool: 'search_files',
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
			`Failed to launch filesystem search engine: ${result.error.message}`,
		)
	}

	if (result.status !== 0) {
		throw new McpError(
			ErrorCode.InternalError,
			result.stderr || `Filesystem search engine exited with status ${result.status}`,
		)
	}

	return JSON.parse(result.stdout) as RustSearchEnvelope
}