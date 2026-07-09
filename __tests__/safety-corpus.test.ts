import { readFileSync } from 'node:fs'
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolvePath } from '../src/utils/path-utils.ts'

const fixtureRoot = path.join(import.meta.dirname, '../test/fixtures/safety/root')

describe('filesystem safety corpus manifest', () => {
	it('lists Phase 0 safety baseline cases', () => {
		const manifest = JSON.parse(
			readFileSync(path.join(import.meta.dirname, '../test/fixtures/safety-corpus-manifest.json'), 'utf8'),
		) as { profile: string; cases: Array<{ id: string }> }

		expect(manifest.profile).toBe('filesystem_safety_fixture_corpus')
		expect(manifest.cases.map((entry) => entry.id)).toEqual([
			'root-traversal',
			'sibling-prefix',
			'symlink-escape',
			'hidden-file',
			'binary-file',
			'oversized-file',
		])
	})
})

describe('filesystem safety fixture corpus', () => {
	let tempOutsideDir: string
	let tempRoot: string

	beforeEach(async () => {
		const suffix = `${Date.now()}-${Math.random()}`
		tempOutsideDir = path.join(os.tmpdir(), `fs-safety-out-${suffix}`)
		tempRoot = path.join(os.tmpdir(), `fs-safety-root-${suffix}`)
		await mkdir(tempOutsideDir, { recursive: true })
		await mkdir(tempRoot, { recursive: true })
		await writeFile(path.join(tempOutsideDir, 'secret.txt'), 'outside-secret\n', 'utf8')
	})

	afterEach(async () => {
		// Best-effort cleanup; temp dirs are unique per test.
	})

	it('rejects root traversal inputs from the manifest', async () => {
		await expect(resolvePath('../outside/secret.txt', tempRoot)).rejects.toMatchObject({
			code: ErrorCode.InvalidRequest,
			message: expect.stringContaining('Path traversal detected'),
		})
	})

	it('rejects sibling-prefix traversal inputs from the manifest', async () => {
		await expect(resolvePath('../override-secret/secret.txt', tempRoot)).rejects.toMatchObject({
			code: ErrorCode.InvalidRequest,
			message: expect.stringContaining('Path traversal detected'),
		})
	})

	it('rejects symlink escape attempts', async () => {
		const linkPath = path.join(tempRoot, 'escape-link')
		await symlink(path.join(tempOutsideDir, 'secret.txt'), linkPath)
		await expect(resolvePath('escape-link', tempRoot)).rejects.toMatchObject({
			code: ErrorCode.InvalidRequest,
			message: expect.stringContaining('symlink'),
		})
	})

	it('allows hidden fixture files inside the safety root', async () => {
		const resolved = await resolvePath('hidden/.secret', fixtureRoot)
		const content = await readFile(resolved, 'utf8')
		expect(content.trim()).toBe('hidden-secret')
	})

	it('allows binary fixture files inside the safety root', async () => {
		const resolved = await resolvePath('binary/tiny.bin', fixtureRoot)
		const bytes = await readFile(resolved)
		expect(bytes.length).toBe(4)
	})

	it('keeps oversized fixture available for future size-policy gates', async () => {
		const resolved = await resolvePath('oversized/large.bin', fixtureRoot)
		const fileStat = await stat(resolved)
		expect(fileStat.size).toBeGreaterThanOrEqual(128 * 1024)
	})
})
