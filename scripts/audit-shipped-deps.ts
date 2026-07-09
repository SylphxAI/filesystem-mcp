import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

type Advisory = {
	id?: number
	url?: string
	title?: string
	severity?: string
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
	dependencies?: Record<string, string>
}
const shippedRoots = new Set(Object.keys(packageJson.dependencies ?? {}))

// Advisories that do not affect the published MCP runtime (CLI-only or dev tooling).
const ignoredGhsa = new Set([
	'ghsa-5j98-mcp5-4vw2', // glob CLI -c/--cmd; shipped path uses glob as a library API only
])

const result = spawnSync('bun', ['audit', '--json'], { encoding: 'utf8' })
if (!result.stdout?.trim()) {
	console.error(result.stderr || 'bun audit produced no output')
	process.exit(result.status ?? 1)
}

const audit = JSON.parse(result.stdout) as Record<string, Advisory[]>
const failures: string[] = []

for (const [packageName, advisories] of Object.entries(audit)) {
	if (!shippedRoots.has(packageName)) {
		continue
	}

	for (const advisory of advisories) {
		const ghsa = advisory.url?.match(/GHSA-[a-z0-9-]+/i)?.[0]?.toLowerCase()
		if (ghsa && ignoredGhsa.has(ghsa)) {
			continue
		}
		if (advisory.severity === 'high' || advisory.severity === 'critical') {
			failures.push(
				`${packageName}: ${advisory.title ?? 'unknown'} (${advisory.severity}) ${advisory.url ?? ''}`.trim(),
			)
		}
	}
}

if (failures.length > 0) {
	console.error('Shipped dependency audit failures:\n' + failures.join('\n'))
	process.exit(1)
}

console.log(`Shipped dependency audit passed (${shippedRoots.size} runtime roots checked)`)
