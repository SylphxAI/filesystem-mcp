import { existsSync, readFileSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const rustServerBin = path.join(repoRoot, 'target/release/filesystem-mcp-server')
const rustCliBin = path.join(repoRoot, 'target/release/filesystem-cli')
const stagedRustBin = path.join(repoRoot, 'bin/native/filesystem-mcp-server')
const tsEntry = path.join(repoRoot, 'dist/index.js')
const binWrapper = path.join(repoRoot, 'bin/filesystem-mcp')

describe('MCP transport boundary', () => {
	beforeAll(() => {
		execSync('bun run build:rust', { cwd: repoRoot, stdio: 'pipe', timeout: 300_000 })
		execSync('bun run build', { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 })
	}, 300_000)

	it('defaults the published bin wrapper to the TypeScript MCP adapter', () => {
		const script = readFileSync(binWrapper, 'utf8')
		expect(script).toContain('dist/index.js')
		const tail = execSync(`grep -v '^#' "${binWrapper}" | tail -n 3`, { encoding: 'utf8' })
		expect(tail).toContain('exec node')
		expect(tail).toContain('$TS_ENTRY')
	})

	it('builds the opt-in rmcp stdio server binary for Phase 4 preview', () => {
		expect(existsSync(rustServerBin)).toBe(true)
		expect(existsSync(stagedRustBin)).toBe(true)
		expect(existsSync(rustCliBin)).toBe(true)
	})

	it('does not ship a TypeScript engine-invoke bridge on the default MCP path', () => {
		expect(existsSync(path.join(repoRoot, 'src/engine-invoke.ts'))).toBe(false)
		expect(existsSync(tsEntry)).toBe(true)
	})

	it('delegates Rust core engine work through filesystem-cli JSON boundary', () => {
		const cliProbe = spawnSync(rustCliBin, [], {
			cwd: repoRoot,
			encoding: 'utf8',
			input: JSON.stringify({ tool: 'content_hash', input: { content: 'boundary-probe' } }),
		})
		expect(cliProbe.status).toBe(0)
		const cliEnvelope = JSON.parse(cliProbe.stdout) as { status?: string; hash?: string }
		expect(cliEnvelope.status).toBe('ok')
		expect(cliEnvelope.hash?.length).toBe(64)
	})

	it('launches the Rust MCP server only when rust transport is requested', () => {
		const script = readFileSync(binWrapper, 'utf8')
		expect(script).toContain('FILESYSTEM_MCP_TRANSPORT')
		expect(script).toContain('filesystem-mcp-server')
		expect(script).toContain('use_rust_transport')
	})

	it('reports doctor diagnostics from the opt-in Rust MCP entrypoint', () => {
		const result = spawnSync(rustServerBin, ['doctor'], {
			cwd: repoRoot,
			encoding: 'utf8',
		})
		const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
		expect(output).toContain('Rust MCP server')
		expect(output).toContain('engine cli')
	})
})