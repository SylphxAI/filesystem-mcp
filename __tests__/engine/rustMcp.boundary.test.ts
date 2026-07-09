import { existsSync, readFileSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const rustServerBin = path.join(repoRoot, 'target/release/filesystem-mcp-server')
const engineInvoke = path.join(repoRoot, 'dist/engine-invoke.js')
const binWrapper = path.join(repoRoot, 'bin/filesystem-mcp')

describe('MCP transport boundary', () => {
	beforeAll(() => {
		execSync('cargo build -q --release -p filesystem-mcp-server', {
			cwd: repoRoot,
			stdio: 'pipe',
			timeout: 180_000,
		})
		execSync('bun run build', { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 })
	}, 180_000)

	it('defaults the published bin wrapper to the TypeScript MCP adapter', () => {
		const script = readFileSync(binWrapper, 'utf8')
		expect(script).toContain('dist/index.js')
		const tail = execSync(`grep -v '^#' "${binWrapper}" | tail -n 3`, { encoding: 'utf8' })
		expect(tail).toContain('exec node')
	})

	it('builds the opt-in rmcp stdio server binary for Phase 4 preview', () => {
		expect(existsSync(rustServerBin)).toBe(true)
	})

	it('ships the engine bridge only for opt-in rust transport', () => {
		expect(existsSync(engineInvoke)).toBe(true)
	})

	it('reports doctor diagnostics from the opt-in Rust MCP entrypoint', () => {
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

	it('launches the Rust MCP server only when rust transport is requested', () => {
		const script = readFileSync(binWrapper, 'utf8')
		expect(script).toContain('FILESYSTEM_MCP_TRANSPORT')
		expect(script).toContain('filesystem-mcp-server')
	})
})