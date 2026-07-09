import { existsSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const rustServerBin = path.join(repoRoot, 'target/release/filesystem-mcp-server')
const engineInvoke = path.join(repoRoot, 'dist/engine-invoke.js')

describe('Rust MCP transport boundary', () => {
	beforeAll(() => {
		execSync('cargo build -q --release -p filesystem-mcp-server', {
			cwd: repoRoot,
			stdio: 'pipe',
			timeout: 180_000,
		})
		execSync('bun run build', { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 })
	}, 180_000)

	it('builds the rmcp stdio server binary', () => {
		expect(existsSync(rustServerBin)).toBe(true)
	})

	it('ships the TypeScript engine bridge for handler delegation', () => {
		expect(existsSync(engineInvoke)).toBe(true)
	})

	it('reports doctor diagnostics from the Rust MCP entrypoint', () => {
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

	it('prefers the Rust MCP binary in the bin wrapper', () => {
		const wrapper = path.join(repoRoot, 'bin/filesystem-mcp')
		const script = execSync(`grep -v '^#' "${wrapper}" | head -n 40`, { encoding: 'utf8' })
		expect(script).toContain('filesystem-mcp-server')
	})
})