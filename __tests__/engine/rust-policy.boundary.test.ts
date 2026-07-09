import { execSync } from 'node:child_process'
import path from 'node:path'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolvePath } from '../../src/utils/path-utils.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('rust policy engine boundary', () => {
	beforeAll(() => {
		execSync('cargo build --release -q', { cwd: repoRoot, stdio: 'pipe' })
		process.env['FILESYSTEM_USE_RUST_POLICY'] = '1'
	})

	afterAll(() => {
		delete process.env['FILESYSTEM_USE_RUST_POLICY']
	})

	it('resolves an existing file through the Rust CLI policy engine', async () => {
		const root = repoRoot
		const resolved = await resolvePath('package.json', root)
		expect(resolved).toBe(path.resolve(root, 'package.json'))
	})

	it('rejects traversal through the Rust CLI policy engine', async () => {
		await expect(resolvePath('../outside/secret.txt', repoRoot)).rejects.toMatchObject({
			code: ErrorCode.InvalidRequest,
		})
	})
})
