import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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
