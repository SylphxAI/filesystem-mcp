import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildReleaseGateReport } from '../scripts/release-gate.js'

describe('filesystem release gate', () => {
	it('passes Phase 0 safety baseline checks', () => {
		const report = buildReleaseGateReport(path.join(import.meta.dirname, '..', 'benchmark-artifacts'))
		expect(report.profile).toBe('filesystem_release_gate')
		expect(report.status).toBe('passed')
		expect(report.summary.failed).toBe(0)
	})
})
