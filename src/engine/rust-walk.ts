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

type RustListOkEnvelope = {
	status: 'ok'
	tool?: 'list_files'
	entries: RustListEntry[]
	metrics: { entries_found: number; elapsed_ms: number; route: string }
	result?: {
		content?: Array<{ type?: string; text?: string }>
	}
}

type RustListEnvelope = RustListOkEnvelope | { status: 'error'; code: string; message: string }

const here = path.dirname(fileURLToPath(import.meta.url))

/** Opt-in Rust walk engine for the TS adapter path (FILESYSTEM_USE_RUST_WALK=1). */
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

	const envelope = JSON.parse(result.stdout) as RustListEnvelope
	if (envelope.status === 'ok' && envelope.result?.content?.[0]?.text) {
		const textPayload = JSON.parse(envelope.result.content[0].text) as
			| string[]
			| RustListEntry[]
			| FormattedStats

		if (Array.isArray(textPayload)) {
			if (textPayload.length > 0 && typeof textPayload[0] === 'string') {
				const paths = textPayload as string[]
				return {
					status: 'ok',
					tool: 'list_files',
					entries: paths.map((entry) => ({ path: entry })),
					metrics: { entries_found: paths.length, elapsed_ms: 0, route: 'rust-walk' },
				}
			}
			const entries = textPayload as RustListEntry[]
			return {
				status: 'ok',
				tool: 'list_files',
				entries,
				metrics: {
					entries_found: entries.length,
					elapsed_ms: 0,
					route: 'rust-walk',
				},
			}
		}

		const stats = textPayload as FormattedStats
		return {
			status: 'ok',
			tool: 'list_files',
			entries: [{ path: stats.path, stats }],
			metrics: { entries_found: 1, elapsed_ms: 0, route: 'rust-walk' },
		}
	}

	if (envelope.status === 'ok') {
		return {
			status: 'ok',
			tool: 'list_files',
			entries: envelope.entries ?? [],
			metrics: envelope.metrics ?? {
				entries_found: envelope.entries?.length ?? 0,
				elapsed_ms: 0,
				route: 'rust-walk',
			},
		}
	}

	return envelope
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
