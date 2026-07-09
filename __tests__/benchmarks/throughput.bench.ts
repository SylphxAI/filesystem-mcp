import { execSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import { PROJECT_ROOT } from '../../src/utils/path-utils.js'

const rustCliBin = join(PROJECT_ROOT, 'target/release/filesystem-cli')

const invokeCli = (tool: string, input: Record<string, unknown>) => {
	const probe = spawnSync(rustCliBin, [], {
		cwd: PROJECT_ROOT,
		encoding: 'utf8',
		env: {
			...process.env,
			FILESYSTEM_ALLOW_LEGACY_ENGINE: '',
		},
		input: JSON.stringify({ tool, input }),
		timeout: 30_000,
	})
	if (probe.status !== 0) {
		throw new Error(probe.stderr || probe.stdout || `filesystem-cli failed for ${tool}`)
	}
	return JSON.parse(probe.stdout) as { status?: string }
}

let fixtureRoot = ''
let fixturePrefix = ''
const filePaths: string[] = []

beforeAll(async () => {
	execSync('bun run build:rust', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 300_000 })
	fixtureRoot = await mkdtemp(join(PROJECT_ROOT, '.bench-fixture-'))
	fixturePrefix = relative(PROJECT_ROOT, fixtureRoot).replaceAll('\\', '/')

	for (let index = 0; index < 10; index += 1) {
		const fileName = `module-${index}.ts`
		const absolutePath = join(fixtureRoot, fileName)
		await writeFile(absolutePath, `export const value${index} = ${index};\n`.repeat(20), 'utf8')
		filePaths.push(`${fixturePrefix}/${fileName}`)
	}
}, 300_000)

afterAll(async () => {
	if (fixtureRoot) {
		await rm(fixtureRoot, { recursive: true, force: true })
	}
})

describe('filesystem throughput', () => {
	bench(
		'read_content: single file',
		() => {
			const envelope = invokeCli('read_content', {
				root: PROJECT_ROOT,
				paths: [filePaths[0]!],
			})
			if (envelope.status !== 'ok') {
				throw new Error('read_content benchmark failed')
			}
		},
		{ time: 500 },
	)

	bench(
		'read_content: batch 10 files',
		() => {
			const envelope = invokeCli('read_content', {
				root: PROJECT_ROOT,
				paths: filePaths,
			})
			if (envelope.status !== 'ok') {
				throw new Error('read_content batch benchmark failed')
			}
		},
		{ time: 500 },
	)

	bench(
		'list_files: recursive tree',
		() => {
			const envelope = invokeCli('list_files', {
				root: PROJECT_ROOT,
				path: fixturePrefix,
				recursive: true,
			})
			if (envelope.status !== 'ok') {
				throw new Error('list_files benchmark failed')
			}
		},
		{ time: 500 },
	)

	bench(
		'search_files: regex across tree',
		() => {
			const envelope = invokeCli('search_files', {
				root: PROJECT_ROOT,
				path: fixturePrefix,
				regex: 'export const',
				file_pattern: '*.ts',
			})
			if (envelope.status !== 'ok') {
				throw new Error('search_files benchmark failed')
			}
		},
		{ time: 500 },
	)
})
