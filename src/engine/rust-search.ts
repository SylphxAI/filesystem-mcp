import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ErrorCode, McpError as OriginalMcpError } from '@modelcontextprotocol/sdk/types.js'

const McpError = OriginalMcpError

type RustSearchMatch = {
	type?: 'match' | 'error'
	file: string
	line?: number
	match?: string
	matched_text?: string
	context?: string[]
	error?: string
}

type RustSearchEnvelope =
	| {
			status: 'ok'
			results: RustSearchMatch[]
			metrics?: {
				files_scanned: number
				matches_found: number
				elapsed_ms: number
			}
	  }
	| { status: 'error'; code: string; message: string }

type CliLegacySuccess = {
	status: string
	tool?: string
	engine?: string
	version?: string
	result?: {
		content?: Array<{ type?: string; text?: string }>
	}
}

type CliError = {
	status: string
	code?: string
	message?: string
}

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

	const stdout = result.stdout.trim()
	const parsed = JSON.parse(stdout) as CliLegacySuccess | CliError | RustSearchEnvelope

	if (parsed.status === 'error') {
		const error = parsed as CliError
		return {
			status: 'error',
			code: error.code ?? 'SEARCH_FAILED',
			message: error.message ?? 'search_files failed',
		}
	}

	// MCP-shaped LegacyToolSuccessEnvelope (cli_bridge / production path).
	const legacy = parsed as CliLegacySuccess
	if (legacy.result?.content?.[0]?.text) {
		const body = JSON.parse(legacy.result.content[0].text) as {
			results?: RustSearchMatch[]
		}
		const results: RustSearchMatch[] = (body.results ?? []).map((entry) => {
			const mapped: RustSearchMatch = {
				type: entry.type ?? 'match',
				file: entry.file,
				matched_text: entry.matched_text ?? entry.match ?? '',
				context: entry.context ?? [],
			}
			// exactOptionalPropertyTypes: omit keys rather than assign undefined
			if (entry.line !== undefined) {
				mapped.line = entry.line
			}
			if (entry.error !== undefined) {
				mapped.error = entry.error
			}
			return mapped
		})
		return {
			status: 'ok',
			results,
			metrics: {
				files_scanned: 0,
				matches_found: results.length,
				elapsed_ms: 0,
			},
		}
	}

	// Legacy top-level SearchSuccessEnvelope (pre-envelope-fix fallback).
	const legacyTop = parsed as {
		status: string
		results?: RustSearchMatch[]
		metrics?: {
			files_scanned: number
			matches_found: number
			elapsed_ms: number
		}
	}
	if (Array.isArray(legacyTop.results)) {
		const ok: Extract<RustSearchEnvelope, { status: 'ok' }> = {
			status: 'ok',
			results: legacyTop.results,
		}
		if (legacyTop.metrics !== undefined) {
			ok.metrics = legacyTop.metrics
		}
		return ok
	}

	throw new McpError(
		ErrorCode.InternalError,
		`Filesystem search engine returned unexpected JSON: ${stdout.slice(0, 200)}`,
	)
}
