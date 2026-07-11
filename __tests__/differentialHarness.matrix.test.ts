import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..')

describe('filesystem-mcp differential harness (rej-010 tick-022 search+stat expand)', () => {
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
		expect(harness).toContain('read_content_differential_matches_ts_oracle')
		expect(harness).toContain('write_content_differential_matches_ts_oracle')
		expect(harness).toContain('search_files_differential_matches_ts_oracle')
		expect(harness).toContain('stat_items_differential_matches_ts_oracle')
		expect(harness).toContain('--slice')
		expect(harness).toContain('differential_green')
		// Fail-closed allow-list
		expect(harness).toContain('list-files|read-content|write-content|search-files|stat-items')
		expect(harness).toContain('invalid --slice value')
	})

	it('parity slice manifest binds list/read/write/search/stat', () => {
		const slice = JSON.parse(
			readFileSync(path.join(repoRoot, 'docs/specs/filesystem-mcp-parity-slice.json'), 'utf8'),
		) as {
			slice: string
			differentialHarness: string
			domains: Array<{ id: string; differentialTest: boolean; boundedSlice?: string; minCases?: number }>
		}

		expect(slice.slice).toContain('tool.list_files')
		expect(slice.slice).toContain('tool.read_content')
		expect(slice.slice).toContain('tool.write_content')
		expect(slice.slice).toContain('tool.search_files')
		expect(slice.slice).toContain('tool.stat_items')
		expect(slice.differentialHarness).toBe('scripts/run-filesystem-mcp-differential.sh')
		expect(slice.domains.some((domain) => domain.id === 'tool/list_files')).toBe(true)
		expect(slice.domains.some((domain) => domain.id === 'tool/read_content')).toBe(true)
		expect(slice.domains.some((domain) => domain.id === 'tool/write_content')).toBe(true)
		expect(slice.domains.some((domain) => domain.id === 'tool/search_files')).toBe(true)
		expect(slice.domains.some((domain) => domain.id === 'tool/stat_items')).toBe(true)
		expect(slice.domains.find((domain) => domain.id === 'tool/list_files')?.boundedSlice).toBe('list-files')
		expect(slice.domains.find((domain) => domain.id === 'tool/search_files')?.boundedSlice).toBe('search-files')
		expect(slice.domains.find((domain) => domain.id === 'tool/stat_items')?.boundedSlice).toBe('stat-items')
		expect(slice.domains.find((domain) => domain.id === 'tool/search_files')?.minCases).toBeGreaterThanOrEqual(3)
		expect(slice.domains.find((domain) => domain.id === 'tool/stat_items')?.minCases).toBeGreaterThanOrEqual(3)
	})

	it('golden fixtures drive bounded oracle cases for each expanded tool', () => {
		const listRead = JSON.parse(
			readFileSync(path.join(repoRoot, 'test/fixtures/golden/list_read.golden.json'), 'utf8'),
		) as {
			cases: Array<{ tool: string }>
		}
		const write = JSON.parse(
			readFileSync(path.join(repoRoot, 'test/fixtures/golden/write_content.golden.json'), 'utf8'),
		) as {
			cases: Array<{ tool: string }>
		}
		const searchStat = JSON.parse(
			readFileSync(path.join(repoRoot, 'test/fixtures/golden/search_stat.golden.json'), 'utf8'),
		) as {
			cases: Array<{ tool: string }>
		}

		const listCases = listRead.cases.filter((testCase) => testCase.tool === 'list_files')
		const readCases = listRead.cases.filter((testCase) => testCase.tool === 'read_content')
		const writeCases = write.cases.filter((testCase) => testCase.tool === 'write_content')
		const searchCases = searchStat.cases.filter((testCase) => testCase.tool === 'search_files')
		const statCases = searchStat.cases.filter((testCase) => testCase.tool === 'stat_items')
		expect(listCases.length).toBeGreaterThanOrEqual(2)
		expect(readCases.length).toBeGreaterThanOrEqual(4)
		expect(writeCases.length).toBeGreaterThanOrEqual(4)
		expect(searchCases.length).toBeGreaterThanOrEqual(3)
		expect(statCases.length).toBeGreaterThanOrEqual(3)
	})

	it('corpus allow-list is fail-closed to expanded RustCore tools only', () => {
		const corpus = JSON.parse(
			readFileSync(path.join(repoRoot, 'scripts/differential/fixtures/filesystem-mcp-corpus.json'), 'utf8'),
		) as {
			toolRouteCases: Array<{ tool: string; expect: string }>
			serverContract: { tools: string[] }
		}

		const allowed = new Set(['list_files', 'read_content', 'write_content', 'search_files', 'stat_items'])
		for (const route of corpus.toolRouteCases) {
			expect(allowed.has(route.tool)).toBe(true)
			expect(route.expect).toBe('RustCore')
		}
		for (const tool of corpus.serverContract.tools) {
			expect(allowed.has(tool)).toBe(true)
		}
	})
})
