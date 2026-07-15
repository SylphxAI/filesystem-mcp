#!/usr/bin/env node

import { createRequire } from 'node:module'
import { formatDoctorReport, runDoctor } from './doctor.js'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version: string }

function main(): void {
	const report = runDoctor(packageJson.version)
	console.log(formatDoctorReport(report))
	process.exit(report.status === 'unavailable' ? 1 : 0)
}

try {
	main()
} catch (error: unknown) {
	console.error('[Filesystem MCP] Doctor error:', error)
	process.exit(1)
}
