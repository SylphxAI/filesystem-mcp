import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { bench, describe, beforeAll, afterAll } from 'vitest'
import { readContentToolDefinition } from '../../src/handlers/read-content.js'
import { listFilesToolDefinition } from '../../src/handlers/list-files.js'
import { searchFilesToolDefinition } from '../../src/handlers/search-files.js'
import { PROJECT_ROOT } from '../../src/utils/path-utils.js'

let fixtureRoot = ''
let fixturePrefix = ''
const filePaths: string[] = []

beforeAll(async () => {
	fixtureRoot = await mkdtemp(join(PROJECT_ROOT, '.bench-fixture-'))
	fixturePrefix = relative(PROJECT_ROOT, fixtureRoot).replaceAll('\\', '/')

	for (let index = 0; index < 10; index += 1) {
		const fileName = `module-${index}.ts`
		const absolutePath = join(fixtureRoot, fileName)
		await writeFile(
			absolutePath,
			`export const value${index} = ${index};\n`.repeat(20),
			'utf8',
		)
		filePaths.push(`${fixturePrefix}/${fileName}`)
	}
})

afterAll(async () => {
	if (fixtureRoot) {
		await rm(fixtureRoot, { recursive: true, force: true })
	}
})

describe('filesystem throughput', () => {
	bench(
		'read_content: single file',
		async () => {
			await readContentToolDefinition.handler({ paths: [filePaths[0]!] })
		},
		{ time: 500 },
	)

	bench(
		'read_content: batch 10 files',
		async () => {
			await readContentToolDefinition.handler({ paths: filePaths })
		},
		{ time: 500 },
	)

	bench(
		'list_files: recursive tree',
		async () => {
			await listFilesToolDefinition.handler({ path: fixturePrefix, recursive: true })
		},
		{ time: 500 },
	)

	bench(
		'search_files: regex across tree',
		async () => {
			await searchFilesToolDefinition.handler({
				path: fixturePrefix,
				regex: 'export const',
				file_pattern: '*.ts',
			})
		},
		{ time: 500 },
	)
})