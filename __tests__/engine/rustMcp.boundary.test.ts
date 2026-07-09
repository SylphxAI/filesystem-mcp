import { existsSync, readFileSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const rustServerBin = path.join(repoRoot, 'target/release/filesystem-mcp-server')
const stagedRustBin = path.join(repoRoot, 'bin/native/filesystem-mcp-server')
const engineInvoke = path.join(repoRoot, 'dist/engine-invoke.js')
const binWrapper = path.join(repoRoot, 'bin/filesystem-mcp')

describe('MCP transport boundary', () => {
	beforeAll(() => {
		execSync('bun run build:rust', { cwd: repoRoot, stdio: 'pipe', timeout: 300_000 })
		execSync('bun run build', { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 })
	}, 300_000)

	it('defaults the published bin wrapper to the Rust rmcp MCP server', () => {
		const script = readFileSync(binWrapper, 'utf8')
		expect(script).toContain('filesystem-mcp-server')
		expect(script).toContain('bin/native/filesystem-mcp-server')
		const tail = execSync(`grep -v '^#' "${binWrapper}" | tail -n 6`, { encoding: 'utf8' })
		expect(tail).toContain('resolve_rust_bin')
		expect(tail).not.toMatch(/^\s*exec node "\$TS_ENTRY"/m)
	})

	it('builds and stages the rmcp stdio server binary for npm publish', () => {
		expect(existsSync(rustServerBin)).toBe(true)
		expect(existsSync(stagedRustBin)).toBe(true)
	})

	it('ships the engine bridge for tool delegation', () => {
		expect(existsSync(engineInvoke)).toBe(true)
	})

	it('reports doctor diagnostics from the default Rust MCP entrypoint', () => {
		const result = spawnSync(rustServerBin, ['doctor'], {
			cwd: repoRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				FILESYSTEM_ENGINE_SCRIPT: engineInvoke,
			},
		})
		const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
		expect(output).toContain('Rust MCP server')
		expect(output).toContain('engine bridge')
	})

	it('keeps the legacy TypeScript MCP adapter available via ts transport', () => {
		const script = readFileSync(binWrapper, 'utf8')
		expect(script).toContain('FILESYSTEM_MCP_TRANSPORT')
		expect(script).toContain('dist/index.js')
		expect(script).toContain('use_ts_transport')
	})
})