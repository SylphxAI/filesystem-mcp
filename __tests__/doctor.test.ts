import { describe, expect, it } from 'vitest'
import { runDoctor } from '../src/doctor.js'

describe('filesystem doctor', () => {
	it('returns structured install diagnostics', () => {
		const report = runDoctor('0.6.1')
		expect(report.profile).toBe('filesystem_doctor')
		expect(['ready', 'degraded', 'unavailable']).toContain(report.status)
		expect(report.checks.some((check) => check.id === 'node')).toBe(true)
		expect(report.checks.some((check) => check.id === 'rust_policy_cli')).toBe(true)
	})
})
