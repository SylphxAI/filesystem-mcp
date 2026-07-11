import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..')

describe('filesystem-mcp differential harness (rej-010 list-files)', () => {
	it('ships fail-closed differential entrypoint and oracle artifacts', () => {
		expect(existsSync(path.join(repoRoot, 'scripts/run-filesystem-mcp-differential.sh'))).toBe(true)
		expect(existsSync(path.join(repoRoot, 'scripts/differential/filesystem-mcp-oracle.ts'))).toBe(true)
		expect(existsSync(path.join(repoRoot, 'scripts/differential/fixtures/filesystem-mcp-corpus.json'))).toBe(true)
		expect(existsSync(path.join(repoRoot, 'crates/filesystem-mcp-server/tests/filesystem_mcp_differential.rs'))).toBe(
			true,
		)

		const harness = readFileSync(path.join(repoRoot, 'scripts/run-filesystem-mcp-differential.sh'), 'utf8')
		expect(harness).toContain('filesystem-mcp-differential')
		expect(harness).toContain('filesystem-mcp-oracle.ts')
		expect(harness).toContain('list_files_differential_matches_ts_oracle')
		expect(harness).toContain('--slice')
		expect(harness).toContain('differential_green')
	})

	it('parity slice manifest binds list_files bounded domain', () => {
		const slice = JSON.parse(
			readFileSync(path.join(repoRoot, 'docs/specs/filesystem-mcp-parity-slice.json'), 'utf8'),
		) as {
			slice: string
			differentialHarness: string
			domains: Array<{ id: string; differentialTest: boolean; boundedSlice?: string }>
		}

		expect(slice.slice).toContain('tool.list_files')
		expect(slice.differentialHarness).toBe('scripts/run-filesystem-mcp-differential.sh')
		expect(slice.domains.some((domain) => domain.id === 'tool/list_files')).toBe(true)
		expect(slice.domains.find((domain) => domain.id === 'tool/list_files')?.boundedSlice).toBe('list-files')
	})

	it('list-read golden fixture drives bounded list_files oracle cases', () => {
		const golden = JSON.parse(
			readFileSync(path.join(repoRoot, 'test/fixtures/golden/list_read.golden.json'), 'utf8'),
		) as {
			cases: Array<{ tool: string }>
		}

		const listCases = golden.cases.filter((testCase) => testCase.tool === 'list_files')
		expect(listCases.length).toBeGreaterThanOrEqual(2)
	})
})
