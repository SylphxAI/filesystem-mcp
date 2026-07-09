import { existsSync, readFileSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const rustServerBin = path.join(repoRoot, 'target/release/filesystem-mcp-server')
const rustCliBin = path.join(repoRoot, 'target/release/filesystem-cli')
const stagedRustBin = path.join(repoRoot, 'bin/native/filesystem-mcp-server')
const legacyRuntime = path.join(repoRoot, 'dist/legacy-engine-runtime.js')
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
		expect(script).not.toContain('engine-invoke.js')
		expect(script).not.toContain('FILESYSTEM_ENGINE_SCRIPT')
		const tail = execSync(`grep -v '^#' "${binWrapper}" | tail -n 6`, { encoding: 'utf8' })
		expect(tail).toContain('resolve_rust_bin')
		expect(tail).not.toMatch(/^\s*exec node "\$TS_ENTRY"/m)
	})

	it('builds and stages the rmcp stdio server binary for npm publish', () => {
		expect(existsSync(rustServerBin)).toBe(true)
		expect(existsSync(stagedRustBin)).toBe(true)
		expect(existsSync(rustCliBin)).toBe(true)
	})

	it('routes MCP engine work through filesystem-cli, not a TS MCP adapter bridge', () => {
		expect(existsSync(legacyRuntime)).toBe(true)
		expect(existsSync(path.join(repoRoot, 'crates/filesystem-mcp-server/src/cli_bridge.rs'))).toBe(
			true,
		)
		expect(existsSync(path.join(repoRoot, 'crates/filesystem-mcp-server/src/engine_bridge.rs'))).toBe(
			false,
		)

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

	it('reports doctor diagnostics from the default Rust MCP entrypoint', () => {
		const result = spawnSync(rustServerBin, ['doctor'], {
			cwd: repoRoot,
			encoding: 'utf8',
		})
		const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
		expect(output).toContain('Rust MCP server')
		expect(output).toContain('engine cli')
		expect(output).not.toContain('engine bridge')
	})

	it('keeps the legacy TypeScript MCP adapter available via ts transport', () => {
		const script = readFileSync(binWrapper, 'utf8')
		expect(script).toContain('FILESYSTEM_MCP_TRANSPORT')
		expect(script).toContain('dist/index.js')
		expect(script).toContain('use_ts_transport')
	})
})