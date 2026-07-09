import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolveRustCliBinary } from './rust-policy.js'

export type WriteAuditFileRecord = {
	path: string
	beforeHash: string
	afterHash: string
	diffCount: number
	success: boolean
}

type ContentHashEnvelope =
	| { status: 'ok'; hash: string }
	| { status: 'error'; code: string; message: string }

type RecordWriteAuditEnvelope =
	| { status: 'ok'; operation_id: string; ledger_path: string; record_count: number }
	| { status: 'error'; code: string; message: string }

export function isRustCliAvailable(): boolean {
	return resolveRustCliBinary() !== 'filesystem-cli'
}

export function shouldUseRustAuditEngine(): boolean {
	if (process.env['FILESYSTEM_USE_RUST_AUDIT'] === '0') {
		return false
	}
	if (process.env['FILESYSTEM_USE_RUST_AUDIT'] === '1') {
		return isRustCliAvailable()
	}
	return isRustCliAvailable()
}

function invokeRustTool<T>(tool: string, input: Record<string, unknown>): T {
	const binary = resolveRustCliBinary()
	const payload = JSON.stringify({ tool, input })
	const result = spawnSync(binary, [], {
		input: payload,
		encoding: 'utf8',
		maxBuffer: 4 * 1024 * 1024,
	})

	if (result.error) {
		throw new Error(`Failed to launch filesystem audit engine: ${result.error.message}`)
	}

	if (result.status !== 0) {
		throw new Error(result.stderr || `Filesystem audit engine exited with status ${result.status}`)
	}

	return JSON.parse(result.stdout) as T
}

export function hashContent(content: string): string {
	if (shouldUseRustAuditEngine()) {
		const envelope = invokeRustTool<ContentHashEnvelope>('content_hash', { content })
		if (envelope.status !== 'ok') {
			throw new Error(envelope.message)
		}
		return envelope.hash
	}

	return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function recordWriteAudit(
	root: string,
	tool: string,
	records: WriteAuditFileRecord[],
): { operationId: string; ledgerPath: string } {
	if (!shouldUseRustAuditEngine()) {
		throw new Error('Rust audit engine is not available')
	}

	const envelope = invokeRustTool<RecordWriteAuditEnvelope>('record_write_audit', {
		root,
		tool,
		records,
	})

	if (envelope.status !== 'ok') {
		throw new Error(envelope.message)
	}

	return {
		operationId: envelope.operation_id,
		ledgerPath: envelope.ledger_path,
	}
}