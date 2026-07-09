import path from 'node:path'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { isPathInside, PROJECT_ROOT, resolvePath } from '../../src/utils/path-utils.ts'

const MOCK_PROJECT_ROOT_OVERRIDE = path.resolve('/mock/project/root/override')
const ACTUAL_PROJECT_ROOT = process.cwd()

describe('pathUtils', () => {
	it('should have PROJECT_ROOT set to the actual process.cwd()', () => {
		expect(PROJECT_ROOT).toBe(ACTUAL_PROJECT_ROOT)
	})

	describe('isPathInside (separator-aware containment)', () => {
		const root = path.resolve('/mock/project/root')

		it('returns true for the root itself', () => {
			expect(isPathInside(root, root)).toBe(true)
		})

		it('returns true for a nested child path', () => {
			expect(isPathInside(path.join(root, 'src/a.ts'), root)).toBe(true)
		})

		// Regression test for sibling-prefix bypass:
		// `/mock/project/root-secret/...` starts with the string `/mock/project/root`
		// but is NOT inside that directory. A naive `startsWith()` check returns true here.
		it('returns false for a sibling-prefix path (security regression)', () => {
			const sibling = path.resolve('/mock/project/root-secret/secret.txt')
			expect(sibling.startsWith(root)).toBe(true) // demonstrates the bug in the old check
			expect(isPathInside(sibling, root)).toBe(false) // the new check correctly rejects
		})

		it('returns false for a parent path', () => {
			expect(isPathInside(path.dirname(root), root)).toBe(false)
		})

		it('returns false for an unrelated absolute path', () => {
			expect(isPathInside(path.resolve('/etc/passwd'), root)).toBe(false)
		})
	})

	describe('resolvePath', () => {
		it('should resolve a valid relative path using override root', async () => {
			const userPath = 'src/file.ts'
			const expectedPath = path.resolve(MOCK_PROJECT_ROOT_OVERRIDE, userPath)
			await expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).resolves.toBe(expectedPath)
		})

		it('should resolve a relative path with "." correctly', async () => {
			const userPath = './src/./file.ts'
			const expectedPath = path.resolve(MOCK_PROJECT_ROOT_OVERRIDE, 'src/file.ts')
			await expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).resolves.toBe(expectedPath)
		})

		it('should resolve a relative path with ".." that stays within root', async () => {
			const userPath = 'src/../dist/bundle.js'
			const expectedPath = path.resolve(MOCK_PROJECT_ROOT_OVERRIDE, 'dist/bundle.js')
			await expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).resolves.toBe(expectedPath)
		})

		it('should reject absolute paths (posix)', async () => {
			await expect(resolvePath('/etc/passwd', MOCK_PROJECT_ROOT_OVERRIDE)).rejects.toThrow(
				/Absolute paths are not allowed/,
			)
			await expect(resolvePath('/etc/passwd', MOCK_PROJECT_ROOT_OVERRIDE)).rejects.toMatchObject({
				code: ErrorCode.InvalidParams,
			})
		})

		it('should reject absolute paths (windows)', async () => {
			const userPath = path.normalize(String.raw`C:\Windows\System32`)
			await expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).rejects.toThrow(/Absolute paths are not allowed/)
		})

		it('should reject parent traversal (..)', async () => {
			await expect(resolvePath('../outside/file', MOCK_PROJECT_ROOT_OVERRIDE)).rejects.toMatchObject({
				code: ErrorCode.InvalidRequest,
				message: expect.stringContaining('Path traversal detected'),
			})
		})

		it('should reject deep parent traversal (../../../..)', async () => {
			await expect(resolvePath('../../../../outside/file', MOCK_PROJECT_ROOT_OVERRIDE)).rejects.toMatchObject({
				code: ErrorCode.InvalidRequest,
			})
		})

		// SECURITY REGRESSION: sibling-prefix path confinement bypass.
		// Reported via responsible disclosure (2026-05). Without separator-aware
		// containment, `../root-secret/secret.txt` resolves to a path that shares
		// the project root's string prefix and was incorrectly accepted.
		it('should reject sibling-prefix paths that escape root (security regression)', async () => {
			// Use a real on-disk root so realpath() succeeds and we exercise the
			// post-realpath check too.
			const root = path.resolve(MOCK_PROJECT_ROOT_OVERRIDE)
			await expect(resolvePath('../override-secret/secret.txt', root)).rejects.toMatchObject({
				code: ErrorCode.InvalidRequest,
				message: expect.stringContaining('Path traversal detected'),
			})
		})

		it('should reject sibling-prefix paths even with a single-character delta', async () => {
			const root = path.resolve('/mock/project/r')
			await expect(resolvePath('../rs/secret.txt', root)).rejects.toMatchObject({
				code: ErrorCode.InvalidRequest,
			})
		})

		it('should reject when input is not a string', async () => {
			await expect(resolvePath(123 as unknown as string, MOCK_PROJECT_ROOT_OVERRIDE)).rejects.toThrow(
				/Path must be a string/,
			)
		})

		it('should handle paths with trailing slashes', async () => {
			const expected = path.resolve(MOCK_PROJECT_ROOT_OVERRIDE, 'src/subdir')
			await expect(resolvePath('src/subdir/', MOCK_PROJECT_ROOT_OVERRIDE)).resolves.toBe(expected)
		})

		it('should handle empty string path (returns root)', async () => {
			await expect(resolvePath('', MOCK_PROJECT_ROOT_OVERRIDE)).resolves.toBe(MOCK_PROJECT_ROOT_OVERRIDE)
		})

		it('should handle "." path (returns root)', async () => {
			await expect(resolvePath('.', MOCK_PROJECT_ROOT_OVERRIDE)).resolves.toBe(MOCK_PROJECT_ROOT_OVERRIDE)
		})
	})
})
