#!/usr/bin/env bun
/**
 * TS contract oracle for filesystem-mcp list_files differential parity (rej-010).
 * Frozen baseline: pure TypeScript list_files handler on golden corpus.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFilesToolDefinition } from '../../src/handlers/list-files.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
// realpath avoids /tmp vs /private/tmp drift on macOS which breaks PROJECT_ROOT confinement.
const REPO_ROOT = realpathSync(join(__dirname, '../..'))
const CORPUS_PATH = join(__dirname, 'fixtures/filesystem-mcp-corpus.json')
const SCRATCH_CANDIDATE =
	process.env.FILESYSTEM_MCP_DIFF_SCRATCH ??
	join(REPO_ROOT, 'test/fixtures/differential-scratch')
mkdirSync(SCRATCH_CANDIDATE, { recursive: true })
const SCRATCH_ROOT = realpathSync(SCRATCH_CANDIDATE)

interface ToolRouteCase {
	id: string
	tool: string
	expect: string
}

interface GoldenCase {
	id: string
	tool: 'list_files'
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

function scopeListFilesInput(root: string, input: Record<string, unknown>): Record<string, unknown> {
	const relativeRoot = relative(REPO_ROOT, root).replace(/\\/g, '/')
	const pathValue =
		input.path === '.' || input.path === undefined
			? relativeRoot
			: join(relativeRoot, String(input.path)).replace(/\\/g, '/')
	return { ...input, path: pathValue }
}

async function invokeListFiles(root: string, input: Record<string, unknown>): Promise<unknown> {
	const scopedInput = scopeListFilesInput(root, input)
	const response = await listFilesToolDefinition.handler(scopedInput)
	return JSON.parse(response.content[0].text)
}

async function main(): Promise<void> {
	const raw = await readFile(CORPUS_PATH, 'utf8')
	const corpus = JSON.parse(raw) as Corpus
	if (corpus.corpusVersion !== 1) {
		throw new Error(`unsupported corpusVersion: ${corpus.corpusVersion}`)
	}

	// Force pure TypeScript list_files for the oracle baseline.
	delete process.env.FILESYSTEM_USE_RUST_WALK
	delete process.env.FILESYSTEM_USE_RUST_POLICY

	const corpusSource = join(REPO_ROOT, corpus.corpusRoot)
	const listReadManifest = JSON.parse(
		readFileSync(join(REPO_ROOT, corpus.listReadGolden), 'utf8'),
	) as GoldenManifest

	const cases: DifferentialCase[] = []
	const listReadRoot = join(SCRATCH_ROOT, 'corpus-list-read')
	copyCorpus(listReadRoot, corpusSource)

	for (const testCase of corpus.toolRouteCases) {
		cases.push({
			id: testCase.id,
			slice: 'tool-route-contract',
			domain: 'toolRouteContract',
			input: { tool: testCase.tool },
			output: { route: testCase.expect },
		})
	}

	const packageJson = JSON.parse(
		await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
	) as { version: string }
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
		if (testCase.tool !== 'list_files') {
			continue
		}
		const payload = await invokeListFiles(listReadRoot, testCase.input)
		const normalized = normalizeListPayload(payload, listReadPrefix)
		cases.push({
			id: `tool-${testCase.id}`,
			slice: 'list-files',
			domain: 'tool',
			input: {
				tool: testCase.tool,
				// Rust CLI root is the isolated corpus directory; args stay
				// corpus-relative (path: ".") so engine-relative paths match.
				root: listReadRoot,
				args: testCase.input,
				isolate: false,
			},
			output: {
				status: 'ok',
				engine: 'filesystem-core',
				payload: normalized,
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
