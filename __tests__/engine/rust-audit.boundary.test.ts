import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
	hashContent,
	isRustCliAvailable,
	recordWriteAudit,
	shouldUseRustAuditEngine,
} from '../../src/engine/rust-audit.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('Rust audit engine boundary', () => {
	const tempRoot = mkdtempSync(path.join(tmpdir(), 'filesystem-audit-'))

	beforeAll(() => {
		execSync('cargo build -q --release', { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 })
	}, 180_000)

	afterAll(() => {
		rmSync(tempRoot, { recursive: true, force: true })
	})

	it('defaults to the Rust CLI when it is built', () => {
		expect(isRustCliAvailable()).toBe(true)
		expect(shouldUseRustAuditEngine()).toBe(true)
	})

	it('hashes content deterministically through the Rust engine', () => {
		const first = hashContent('audit fixture')
		const second = hashContent('audit fixture')
		expect(first).toBe(second)
		expect(first).toHaveLength(64)
	})

	it('appends apply_diff audit records with rollback snapshots to the project ledger', () => {
		const beforeContent = 'before\n'
		const beforeHash = hashContent(beforeContent)
		const afterHash = hashContent('after\n')
		const recorded = recordWriteAudit(tempRoot, 'apply_diff', [
			{
				path: 'src/example.ts',
				beforeHash,
				afterHash,
				diffCount: 1,
				success: true,
				beforeContent,
			},
		])

		expect(recorded.operationId.startsWith('op_')).toBe(true)
		expect(existsSync(recorded.ledgerPath)).toBe(true)
		expect(recorded.records[0]?.rollback?.available).toBe(true)
		expect(recorded.records[0]?.rollback?.snapshot_path).toContain(
			'.filesystem-mcp/rollback/',
		)
		expect(recorded.records[0]?.rollback?.restore_content_hash).toBe(beforeHash)

		const ledger = readFileSync(recorded.ledgerPath, 'utf8').trim().split('\n')
		const last = JSON.parse(ledger[ledger.length - 1] as string) as {
			operationId?: string
			tool: string
			records: Array<{
				path: string
				beforeHash: string
				afterHash: string
				rollback?: { available: boolean; snapshotPath?: string }
			}>
		}
		expect(last.tool).toBe('apply_diff')
		expect(last.operationId?.startsWith('op_')).toBe(true)
		expect(last.records[0]?.path).toBe('src/example.ts')
		expect(last.records[0]?.beforeHash).toBe(beforeHash)
		expect(last.records[0]?.afterHash).toBe(afterHash)
		expect(last.records[0]?.rollback?.available).toBe(true)
		expect(last.records[0]?.rollback?.snapshotPath).toContain('src__example.ts.snapshot')
	})
})