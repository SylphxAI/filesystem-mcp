import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { handleApplyDiff } from '../../src/handlers/apply-diff.js'
import { hashContent } from '../../src/engine/rust-audit.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('apply_diff audit envelope', () => {
	let tempRoot = ''

	beforeAll(() => {
		execSync('cargo build -q --release', { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 })
	}, 180_000)

	afterEach(() => {
		if (tempRoot) {
			rmSync(tempRoot, { recursive: true, force: true })
			tempRoot = ''
		}
	})

	it('records operation_id and content hashes for successful writes', async () => {
		tempRoot = mkdtempSync(path.join(tmpdir(), 'filesystem-apply-diff-'))
		const target = path.join(tempRoot, 'sample.txt')
		writeFileSync(target, 'alpha\nbeta\n', 'utf8')

		const result = await handleApplyDiff(
			[
				{
					path: 'sample.txt',
					diffs: [
						{
							search: 'alpha',
							replace: 'gamma',
							start_line: 1,
							end_line: 1,
						},
					],
				},
			],
			{
				projectRoot: tempRoot,
				path,
				readFile: async (filePath: string) => readFileSync(filePath, 'utf8'),
				writeFile: async (filePath: string, content: string) => {
					writeFileSync(filePath, content, 'utf8')
				},
			},
		)

		expect(result.success).toBe(true)
		expect(result.operation_id?.startsWith('op_')).toBe(true)
		expect(result.audit?.ledger_path).toContain('.filesystem-mcp/audit.jsonl')
		expect(result.results[0]?.before_hash).toHaveLength(64)
		expect(result.results[0]?.after_hash).toHaveLength(64)
		expect(result.results[0]?.before_hash).not.toBe(result.results[0]?.after_hash)
		expect(readFileSync(target, 'utf8')).toContain('gamma')
	})

	it('rejects stale expected_content_hash conflicts without writing', async () => {
		tempRoot = mkdtempSync(path.join(tmpdir(), 'filesystem-apply-diff-'))
		const target = path.join(tempRoot, 'sample.txt')
		writeFileSync(target, 'alpha\n', 'utf8')

		const result = await handleApplyDiff(
			[
				{
					path: 'sample.txt',
					expected_content_hash: '0'.repeat(64),
					diffs: [
						{
							search: 'alpha',
							replace: 'gamma',
							start_line: 1,
							end_line: 1,
						},
					],
				},
			],
			{
				projectRoot: tempRoot,
				path,
				readFile: async (filePath: string) => readFileSync(filePath, 'utf8'),
				writeFile: async (filePath: string, content: string) => {
					writeFileSync(filePath, content, 'utf8')
				},
			},
		)

		expect(result.success).toBe(false)
		expect(result.results[0]?.error).toContain('Content hash conflict')
		expect(readFileSync(target, 'utf8')).toBe('alpha\n')
		expect(hashContent('alpha\n')).toBe(result.results[0]?.before_hash)
	})
})