import { execSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleListFilesFunc } from '../../src/handlers/list-files.js'
import { promises as fsPromises } from 'node:fs'

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('rust walk engine boundary', () => {
	beforeAll(() => {
		execSync('cargo build --release -q', { cwd: repoRoot, stdio: 'pipe' })
		process.env.FILESYSTEM_USE_RUST_WALK = '1'
	})

	afterAll(() => {
		delete process.env.FILESYSTEM_USE_RUST_WALK
	})

	it('delegates list_files to the Rust CLI for recursive directory walks', async () => {
		const tempDir = await fsPromises.mkdtemp(path.join(repoRoot, 'temp-rust-walk-'))
		await fsPromises.writeFile(path.join(tempDir, 'alpha.txt'), 'alpha')
		await fsPromises.mkdir(path.join(tempDir, 'nested'))
		await fsPromises.writeFile(path.join(tempDir, 'nested', 'beta.txt'), 'beta')

		const relativePath = path.relative(repoRoot, tempDir)
		const response = await handleListFilesFunc(
			{
				stat: fsPromises.stat,
				readdir: fsPromises.readdir as never,
				glob: async () => [],
				resolvePath: async (userPath: string) => path.resolve(repoRoot, userPath),
				PROJECT_ROOT: repoRoot,
				formatStats: () => {
					throw new Error('formatStats should not run in rust walk mode')
				},
				path: {
					join: path.join,
					dirname: path.dirname,
					resolve: path.resolve,
					relative: path.relative,
					basename: path.basename,
				},
			},
			{
				path: relativePath,
				recursive: true,
				include_stats: false,
			},
		)

		const resultData = JSON.parse(response.content[0].text) as string[]
		expect(resultData.some((entry) => entry.endsWith('alpha.txt'))).toBe(true)
		expect(resultData.some((entry) => entry.endsWith('nested/beta.txt'))).toBe(true)

		await fsPromises.rm(tempDir, { recursive: true, force: true })
	})

	it('keeps walk logic out of the TypeScript handler sources', async () => {
		const { readFileSync } = await import('node:fs')
		const handlerSrc = readFileSync(path.join(repoRoot, 'src/handlers/list-files.ts'), 'utf8')
		const engineSrc = readFileSync(path.join(repoRoot, 'src/engine/rust-walk.ts'), 'utf8')

		expect(engineSrc).toContain('spawnSync')
		expect(handlerSrc).toContain('listFilesViaRustEngine')
		expect(handlerSrc).not.toMatch(/WalkDir|max_depth/)
	})
})