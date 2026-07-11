import { execSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const rustCliBin = path.join(repoRoot, 'target/release/filesystem-cli')

type CliEnvelope = {
	status?: string
	code?: string
	message?: string
	engine?: string
	hash?: string
	entries?: unknown[]
	results?: unknown[]
	resolved_path?: string
	tool?: string
	result?: {
		content?: Array<{ type?: string; text?: string }>
	}
}

const invokeCli = (tool: string, input: Record<string, unknown>, env: NodeJS.ProcessEnv) => {
	const probe = spawnSync(rustCliBin, [], {
		cwd: repoRoot,
		encoding: 'utf8',
		env,
		input: JSON.stringify({ tool, input }),
		timeout: 30_000,
	})
	expect(probe.status).toBe(0)
	return JSON.parse(probe.stdout) as CliEnvelope
}

describe('shipped path matrix (Rust core, no legacy flags)', () => {
	let fakeNodeEnv: NodeJS.ProcessEnv
	let nodeInvokeLog: string
	let matrixDir: string

	beforeAll(() => {
		execSync('bun run build:rust', { cwd: repoRoot, stdio: 'pipe', timeout: 300_000 })

		const probeDir = mkdtempSync(path.join(os.tmpdir(), 'filesystem-matrix-probe-'))
		nodeInvokeLog = path.join(probeDir, 'node-invoke.log')
		const fakeNode = path.join(probeDir, 'node')
		writeFileSync(fakeNode, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> "${nodeInvokeLog}"\nexit 99\n`)
		chmodSync(fakeNode, 0o755)

		matrixDir = mkdtempSync(path.join(repoRoot, 'temp-shipped-matrix-'))
		writeFileSync(path.join(matrixDir, 'probe.txt'), 'matrix-probe-content')

		fakeNodeEnv = {
			...process.env,
			FILESYSTEM_NODE: fakeNode,
			FILESYSTEM_ALLOW_LEGACY_ENGINE: '',
		}
	}, 300_000)

	afterAll(() => {
		if (matrixDir) {
			rmSync(matrixDir, { recursive: true, force: true })
		}
	})

	it('list_files routes through filesystem-core without legacy runtime', () => {
		const relative = path.relative(repoRoot, matrixDir)
		const envelope = invokeCli(
			'list_files',
			{ root: repoRoot, path: relative, recursive: false, include_stats: false },
			fakeNodeEnv,
		)
		expect(envelope.status).toBe('ok')
		expect(envelope.engine).toBe('filesystem-core')
		expect(envelope.tool).toBe('list_files')
		const payload = JSON.parse(envelope.result?.content?.[0]?.text ?? '[]') as string[]
		expect(payload.some((entry) => entry.endsWith('probe.txt'))).toBe(true)
		expect(existsSync(nodeInvokeLog)).toBe(false)
	})

	it('search_files routes through filesystem-core without legacy runtime', () => {
		const relative = path.relative(repoRoot, matrixDir)
		const envelope = invokeCli('search_files', { root: repoRoot, path: relative, regex: 'matrix-probe' }, fakeNodeEnv)
		expect(envelope.status).toBe('ok')
		expect(envelope.engine).toBe('filesystem-core')
		expect((envelope.results ?? []).length).toBeGreaterThan(0)
		expect(existsSync(nodeInvokeLog)).toBe(false)
	})

	it('content_hash returns deterministic Rust digest', () => {
		const envelope = invokeCli('content_hash', { content: 'matrix-probe' }, fakeNodeEnv)
		expect(envelope.status).toBe('ok')
		expect(envelope.hash?.length).toBe(64)
		expect(existsSync(nodeInvokeLog)).toBe(false)
	})

	it('resolve_path returns root-scoped absolute path', () => {
		const envelope = invokeCli('resolve_path', { root: repoRoot, relative_path: 'package.json' }, fakeNodeEnv)
		expect(envelope.status).toBe('ok')
		expect(envelope.resolved_path).toContain('package.json')
		expect(existsSync(nodeInvokeLog)).toBe(false)
	})

	it('default MCP list_files shape works without explicit root (cwd default)', () => {
		const relative = path.relative(repoRoot, matrixDir)
		const envelope = invokeCli('list_files', { path: relative, recursive: false }, fakeNodeEnv)
		expect(envelope.status).toBe('ok')
		expect(envelope.engine).toBe('filesystem-core')
		expect(existsSync(nodeInvokeLog)).toBe(false)
	})

	it('read_content routes through filesystem-core without legacy runtime', () => {
		const relative = path.relative(repoRoot, path.join(matrixDir, 'probe.txt'))
		const envelope = invokeCli('read_content', { root: repoRoot, paths: [relative] }, fakeNodeEnv)
		expect(envelope.status).toBe('ok')
		expect(envelope.engine).toBe('filesystem-core')
		expect(envelope.tool).toBe('read_content')
		const payload = JSON.parse(envelope.result?.content?.[0]?.text ?? '[]') as Array<{
			path?: string
			content?: string
		}>
		expect(payload[0]?.content).toContain('matrix-probe-content')
		expect(existsSync(nodeInvokeLog)).toBe(false)
	})

	it('write_content routes through filesystem-core without legacy runtime', () => {
		const relative = path.relative(repoRoot, path.join(matrixDir, 'written.txt'))
		const envelope = invokeCli(
			'write_content',
			{
				root: repoRoot,
				items: [{ path: relative, content: 'matrix-write-probe' }],
			},
			fakeNodeEnv,
		)
		expect(envelope.status).toBe('ok')
		expect(envelope.engine).toBe('filesystem-core')
		expect(envelope.tool).toBe('write_content')
		const payload = JSON.parse(envelope.result?.content?.[0]?.text ?? '[]') as Array<{
			success?: boolean
		}>
		expect(payload[0]?.success).toBe(true)
		expect(existsSync(nodeInvokeLog)).toBe(false)
	})

	it('stat_items routes through filesystem-core without legacy runtime', () => {
		const relative = path.relative(repoRoot, path.join(matrixDir, 'probe.txt'))
		const envelope = invokeCli('stat_items', { root: repoRoot, paths: [relative] }, fakeNodeEnv)
		expect(envelope.status).toBe('ok')
		expect(envelope.engine).toBe('filesystem-core')
		expect(envelope.tool).toBe('stat_items')
		const payload = JSON.parse(envelope.result?.content?.[0]?.text ?? '[]') as Array<{
			status?: string
		}>
		expect(payload[0]?.status).toBe('success')
		expect(existsSync(nodeInvokeLog)).toBe(false)
	})

	it('documents explicit shipped routing table in mcp-server sources', () => {
		const routes = readFileSync(path.join(repoRoot, 'crates/filesystem-mcp-server/src/tool_routes.rs'), 'utf8')
		expect(routes).toContain('list_files')
		expect(routes).toContain('read_content')
		expect(routes).toContain('RustCore')
		expect(routes).toContain('LegacyOptIn')
	})
})
