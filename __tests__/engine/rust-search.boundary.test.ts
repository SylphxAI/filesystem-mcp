import { execSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleSearchFilesFunc } from '../../src/handlers/search-files.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('rust search engine boundary', () => {
	beforeAll(() => {
		execSync('cargo build --release -q', { cwd: repoRoot, stdio: 'pipe' })
		process.env.FILESYSTEM_USE_RUST_SEARCH = '1'
	})

	afterAll(() => {
		delete process.env.FILESYSTEM_USE_RUST_SEARCH
	})

	it('delegates search_files to the Rust CLI and returns structured matches', async () => {
		const response = await handleSearchFilesFunc(
			{
				readFile: async () => '',
				glob: async () => [],
				resolvePath: async (relativePath: string) => path.resolve(repoRoot, relativePath),
				PROJECT_ROOT: repoRoot,
				pathRelative: path.relative,
				pathJoin: path.join,
			},
			{
				path: '.',
				regex: 'filesystem-mcp',
				file_pattern: 'package.json',
			},
		)

		const results = response.data?.results ?? []
		expect(results.some((entry) => entry.type === 'match' && entry.file === 'package.json')).toBe(true)
	})
})
