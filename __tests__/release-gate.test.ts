import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.join(import.meta.dirname, '..')
const artifactPath = path.join(repoRoot, 'benchmark-artifacts', 'filesystem_release_gate.json')

describe('filesystem release gate', () => {
	it('passes Phase 0 safety baseline checks', () => {
		const result = spawnSync('bun', ['run', 'benchmark:release-gate'], {
			cwd: repoRoot,
			encoding: 'utf8',
			timeout: 120_000,
		})

		expect(result.status).toBe(0)

		const report = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
			profile: string
			status: string
			summary: { failed: number }
		}
		expect(report.profile).toBe('filesystem_release_gate')
		expect(report.status).toBe('passed')
		expect(report.summary.failed).toBe(0)
	}, 120_000)
})
