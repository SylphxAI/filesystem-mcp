#!/usr/bin/env bun
/**
 * TS contract oracle for filesystem-mcp differential parity (rej-010 / tick-022).
 * Frozen baseline: pure TypeScript list_files + read_content + write_content +
 * search_files + stat_items handlers on golden corpus.
 * Fail-closed allow-list — no silent extra tools.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFilesToolDefinition } from '../../src/handlers/list-files.ts'
import { readContentToolDefinition } from '../../src/handlers/read-content.ts'
import { searchFilesToolDefinition } from '../../src/handlers/search-files.ts'
import { statItemsToolDefinition } from '../../src/handlers/stat-items.ts'
import { writeContentToolDefinition } from '../../src/handlers/write-content.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
// realpath avoids /tmp vs /private/tmp drift on macOS which breaks PROJECT_ROOT confinement.
const REPO_ROOT = realpathSync(join(__dirname, '../..'))
const CORPUS_PATH = join(__dirname, 'fixtures/filesystem-mcp-corpus.json')
const SCRATCH_CANDIDATE =
	process.env.FILESYSTEM_MCP_DIFF_SCRATCH ?? join(REPO_ROOT, 'test/fixtures/differential-scratch')
mkdirSync(SCRATCH_CANDIDATE, { recursive: true })
const SCRATCH_ROOT = realpathSync(SCRATCH_CANDIDATE)

/** Fail-closed tool allow-list for main-bound differential expansion. */
const ALLOWED_TOOLS = new Set([
	'list_files',
	'read_content',
	'write_content',
	'search_files',
	'stat_items',
] as const)
type AllowedTool = 'list_files' | 'read_content' | 'write_content' | 'search_files' | 'stat_items'

interface ToolRouteCase {
	id: string
	tool: string
	expect: string
}

interface GoldenCase {
	id: string
	tool: AllowedTool
	input: Record<string, unknown>
	expects?: Record<string, unknown>
}

interface GoldenManifest {
	cases: GoldenCase[]
}

interface Corpus {
	corpusVersion: number
	corpusRoot: string
	listReadGolden: string
	writeContentGolden: string
	searchStatGolden: string
	toolRouteCases: ToolRouteCase[]
	serverContract: {
		name: string
		tools: string[]
	}
}

export interface DifferentialCase {
	readonly id: string
	readonly slice: string
	readonly domain: 'tool' | 'toolRouteContract' | 'serverContract'
	readonly input: Record<string, unknown>
	readonly output: unknown
}

const TOOL_SLICE: Record<AllowedTool, string> = {
	list_files: 'list-files',
	read_content: 'read-content',
	write_content: 'write-content',
	search_files: 'search-files',
	stat_items: 'stat-items',
}

const sortPaths = (paths: string[]) => [...paths].sort()

const stripCorpusPrefix = (value: string, prefix: string) => {
	if (value === prefix) {
		return '.'
	}
	const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
	if (value.startsWith(`${normalized}/`)) {
		return value.slice(normalized.length + 1)
	}
	return value
}

const corpusPrefixFor = (root: string) => relative(REPO_ROOT, root).replace(/\\/g, '/')

const normalizeListPayload = (value: unknown, prefix: string) => {
	if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
		return sortPaths((value as string[]).map((entry) => stripCorpusPrefix(entry, prefix)))
	}
	if (Array.isArray(value)) {
		return sortPaths(
			(value as Array<{ path?: string }>).map((entry) =>
				stripCorpusPrefix(entry.path ?? '', prefix),
			),
		)
	}
	return value
}

const normalizeReadError = (error: string | undefined, prefix: string) => {
	if (!error) {
		return error
	}
	const match = error.match(/\(from relative path '([^']+)'\)/)
	if (!match) {
		return error
	}
	const relativePath = stripCorpusPrefix(match[1], prefix)
	return error.replace(match[0], `(from relative path '${relativePath}')`)
}

const normalizeReadPayload = (
	results: Array<{ path?: string; content?: string | unknown; error?: string }>,
	prefix: string,
) =>
	results.map((entry) => ({
		...entry,
		path: stripCorpusPrefix(entry.path ?? '', prefix),
		error: normalizeReadError(entry.error, prefix),
	}))

const normalizeWritePayload = (
	results: Array<{
		path?: string
		success?: boolean
		operation?: string
		code?: string
		error?: string
	}>,
	prefix: string,
) =>
	results.map((entry) => ({
		path: entry.path ? stripCorpusPrefix(entry.path, prefix) : entry.path,
		success: entry.success,
		operation: entry.operation,
		code: entry.code,
		error: entry.error,
	}))

/** Stable search payload: strip path prefix, sort by file+line, drop volatile fields. */
const normalizeSearchPayload = (
	payload: {
		results?: Array<{
			type?: string
			file?: string
			line?: number
			match?: string
			context?: string[]
			error?: string
		}>
	},
	prefix: string,
) => {
	const results = (payload.results ?? [])
		.map((entry) => ({
			type: entry.type ?? 'match',
			file: stripCorpusPrefix(entry.file ?? '', prefix),
			line: entry.line ?? null,
			match: entry.match ?? null,
			context: entry.context ?? [],
			error: entry.error ?? null,
		}))
		.sort((a, b) => {
			const fileCmp = a.file.localeCompare(b.file)
			if (fileCmp !== 0) return fileCmp
			return (a.line ?? 0) - (b.line ?? 0)
		})
	return { results }
}

/** Stable stat payload: strip path prefix; drop timestamps / uid / gid. */
const normalizeStatPayload = (
	results: Array<{
		path?: string
		status?: string
		error?: string
		stats?: {
			path?: string
			isFile?: boolean
			isDirectory?: boolean
			isSymbolicLink?: boolean
			size?: number
			mode?: string
		}
	}>,
	prefix: string,
) =>
	results.map((entry) => {
		const normalized: Record<string, unknown> = {
			path: stripCorpusPrefix(entry.path ?? '', prefix),
			status: entry.status,
		}
		if (entry.error) {
			normalized.error = entry.error
		}
		if (entry.stats) {
			normalized.stats = {
				path: stripCorpusPrefix(entry.stats.path ?? entry.path ?? '', prefix),
				isFile: entry.stats.isFile,
				isDirectory: entry.stats.isDirectory,
				isSymbolicLink: entry.stats.isSymbolicLink,
				size: entry.stats.size,
				mode: entry.stats.mode,
			}
		}
		return normalized
	})

function fixtureCorpusHash(raw: string): string {
	return createHash('sha256').update(raw).digest('hex')
}

function copyCorpus(destination: string, source: string): void {
	mkdirSync(dirname(destination), { recursive: true })
	if (existsSync(destination)) {
		rmSync(destination, { recursive: true, force: true })
	}
	cpSync(source, destination, { recursive: true })
}

function assertAllowedTool(tool: string, context: string): asserts tool is AllowedTool {
	if (!ALLOWED_TOOLS.has(tool as AllowedTool)) {
		throw new Error(
			`fail-closed allow-list rejected tool "${tool}" in ${context}; allowed: ${[...ALLOWED_TOOLS].join(', ')}`,
		)
	}
}

function scopeToolInput(
	tool: AllowedTool,
	root: string,
	input: Record<string, unknown>,
): Record<string, unknown> {
	const relativeRoot = relative(REPO_ROOT, root).replace(/\\/g, '/')
	if (tool === 'list_files' || tool === 'search_files') {
		const pathValue =
			input.path === '.' || input.path === undefined
				? relativeRoot
				: join(relativeRoot, String(input.path)).replace(/\\/g, '/')
		return { ...input, path: pathValue }
	}
	if (tool === 'read_content' || tool === 'stat_items') {
		return {
			...input,
			paths: (input.paths as string[]).map((entry) =>
				join(relativeRoot, entry).replace(/\\/g, '/'),
			),
		}
	}
	// write_content
	return {
		items: (
			input.items as Array<{
				path: string
				content: string
				append?: boolean
				expectedContentHash?: string
			}>
		).map((item) => ({
			...item,
			path: join(relativeRoot, item.path).replace(/\\/g, '/'),
		})),
	}
}

async function invokeToolHandler(
	tool: AllowedTool,
	root: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const scopedInput = scopeToolInput(tool, root, input)
	const handler =
		tool === 'list_files'
			? listFilesToolDefinition.handler
			: tool === 'read_content'
				? readContentToolDefinition.handler
				: tool === 'write_content'
					? writeContentToolDefinition.handler
					: tool === 'search_files'
						? searchFilesToolDefinition.handler
						: statItemsToolDefinition.handler
	const response = await handler(scopedInput)
	return JSON.parse(response.content[0].text)
}

function normalizeToolPayload(tool: AllowedTool, payload: unknown, prefix: string): unknown {
	if (tool === 'list_files') {
		return normalizeListPayload(payload, prefix)
	}
	if (tool === 'read_content') {
		return normalizeReadPayload(
			payload as Array<{ path?: string; content?: unknown; error?: string }>,
			prefix,
		)
	}
	if (tool === 'write_content') {
		return normalizeWritePayload(
			payload as Array<{
				path?: string
				success?: boolean
				operation?: string
				code?: string
				error?: string
			}>,
			prefix,
		)
	}
	if (tool === 'search_files') {
		return normalizeSearchPayload(
			payload as {
				results?: Array<{
					type?: string
					file?: string
					line?: number
					match?: string
					context?: string[]
					error?: string
				}>
			},
			prefix,
		)
	}
	return normalizeStatPayload(
		payload as Array<{
			path?: string
			status?: string
			error?: string
			stats?: {
				path?: string
				isFile?: boolean
				isDirectory?: boolean
				isSymbolicLink?: boolean
				size?: number
				mode?: string
			}
		}>,
		prefix,
	)
}

async function main(): Promise<void> {
	const raw = await readFile(CORPUS_PATH, 'utf8')
	const corpus = JSON.parse(raw) as Corpus
	if (corpus.corpusVersion !== 1) {
		throw new Error(`unsupported corpusVersion: ${corpus.corpusVersion}`)
	}

	// Force pure TypeScript handlers for the oracle baseline.
	delete process.env.FILESYSTEM_USE_RUST_WALK
	delete process.env.FILESYSTEM_USE_RUST_CONTENT
	delete process.env.FILESYSTEM_USE_RUST_WRITE
	delete process.env.FILESYSTEM_USE_RUST_POLICY
	delete process.env.FILESYSTEM_USE_RUST_SEARCH

	const corpusSource = join(REPO_ROOT, corpus.corpusRoot)
	const listReadManifest = JSON.parse(
		readFileSync(join(REPO_ROOT, corpus.listReadGolden), 'utf8'),
	) as GoldenManifest
	const writeManifest = JSON.parse(
		readFileSync(join(REPO_ROOT, corpus.writeContentGolden), 'utf8'),
	) as GoldenManifest
	const searchStatManifest = JSON.parse(
		readFileSync(join(REPO_ROOT, corpus.searchStatGolden), 'utf8'),
	) as GoldenManifest

	const cases: DifferentialCase[] = []
	const listReadRoot = join(SCRATCH_ROOT, 'corpus-list-read')
	copyCorpus(listReadRoot, corpusSource)

	for (const testCase of corpus.toolRouteCases) {
		assertAllowedTool(testCase.tool, `toolRouteCases/${testCase.id}`)
		cases.push({
			id: testCase.id,
			slice: 'tool-route-contract',
			domain: 'toolRouteContract',
			input: { tool: testCase.tool },
			output: { route: testCase.expect },
		})
	}

	for (const tool of corpus.serverContract.tools) {
		assertAllowedTool(tool, 'serverContract.tools')
	}

	const packageJson = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as {
		version: string
	}
	cases.push({
		id: 'server-contract-rmcp',
		slice: 'server-contract',
		domain: 'serverContract',
		input: { tools: corpus.serverContract.tools },
		output: {
			name: corpus.serverContract.name,
			// Bind to package.json version (authoritative public surface).
			version: packageJson.version,
			tools: corpus.serverContract.tools,
		},
	})

	const listReadPrefix = corpusPrefixFor(listReadRoot)
	for (const testCase of listReadManifest.cases) {
		assertAllowedTool(testCase.tool, `listReadGolden/${testCase.id}`)
		const payload = await invokeToolHandler(testCase.tool, listReadRoot, testCase.input)
		cases.push({
			id: `tool-${testCase.id}`,
			slice: TOOL_SLICE[testCase.tool],
			domain: 'tool',
			input: {
				tool: testCase.tool,
				// Rust CLI root is the isolated corpus directory; args stay
				// corpus-relative so engine-relative paths match.
				root: listReadRoot,
				args: testCase.input,
				isolate: false,
			},
			output: {
				status: 'ok',
				engine: 'filesystem-core',
				payload: normalizeToolPayload(testCase.tool, payload, listReadPrefix),
			},
		})
	}

	for (const testCase of writeManifest.cases) {
		assertAllowedTool(testCase.tool, `writeContentGolden/${testCase.id}`)
		const caseRoot = join(SCRATCH_ROOT, 'cases', testCase.id)
		copyCorpus(caseRoot, corpusSource)
		const casePrefix = corpusPrefixFor(caseRoot)
		const payload = await invokeToolHandler(testCase.tool, caseRoot, testCase.input)
		cases.push({
			id: `tool-${testCase.id}`,
			slice: TOOL_SLICE[testCase.tool],
			domain: 'tool',
			input: {
				tool: testCase.tool,
				root: caseRoot,
				args: testCase.input,
				isolate: true,
			},
			output: {
				status: 'ok',
				engine: 'filesystem-core',
				payload: normalizeToolPayload(testCase.tool, payload, casePrefix),
			},
		})
	}

	// search_files + stat_items share the non-mutating list/read corpus root.
	for (const testCase of searchStatManifest.cases) {
		assertAllowedTool(testCase.tool, `searchStatGolden/${testCase.id}`)
		const payload = await invokeToolHandler(testCase.tool, listReadRoot, testCase.input)
		cases.push({
			id: `tool-${testCase.id}`,
			slice: TOOL_SLICE[testCase.tool],
			domain: 'tool',
			input: {
				tool: testCase.tool,
				root: listReadRoot,
				args: testCase.input,
				isolate: false,
			},
			output: {
				status: 'ok',
				engine: 'filesystem-core',
				payload: normalizeToolPayload(testCase.tool, payload, listReadPrefix),
			},
		})
	}

	const payload = {
		corpusVersion: corpus.corpusVersion,
		fixtureCorpusHash: fixtureCorpusHash(raw),
		scratchRoot: SCRATCH_ROOT,
		cases,
	}
	process.stdout.write(`${JSON.stringify(payload)}\n`)
}

await main()
