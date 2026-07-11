import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

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

	it('defaults the published bin wrapper to the Rust rmcp MCP server', () => {
		const script = readFileSync(binWrapper, 'utf8')
		expect(script).toContain('filesystem-mcp-server')
		expect(script).toContain('resolve_rust_bin')
		expect(script).toContain('use_ts_transport')
		// Default path execs the resolved native bin; TS is only via use_ts_transport opt-in.
		expect(script).toContain('exec "$bin"')
		expect(script).toMatch(/if bin="\$\(resolve_rust_bin\)"; then[\s\S]*exec "\$bin"/)
		// Arch-aware resolution (optionalDependencies) must be present for multi-arch npm.
		expect(script).toContain('resolve_from_optional_dep')
		expect(script).toContain('is_runnable_native')
		expect(script).toContain('@sylphx/filesystem-mcp-darwin-arm64')
	})

	it('executes the shipped default bin path through the Rust rmcp server', () => {
		const result = spawnSync(binWrapper, ['doctor'], {
			cwd: repoRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				FILESYSTEM_MCP_TRANSPORT: '',
			},
			timeout: 30_000,
		})

		const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
		expect(result.status).toBe(0)
		expect(output).toContain('Rust MCP server')
		expect(output).toContain('engine cli')
	})

	it('builds the rmcp stdio server binary for the default MCP path', () => {
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

	it('allows opt-in TypeScript MCP transport via FILESYSTEM_MCP_TRANSPORT=ts', () => {
		const script = readFileSync(binWrapper, 'utf8')
		expect(script).toContain('FILESYSTEM_MCP_TRANSPORT')
		expect(script).toContain('use_ts_transport')
		expect(script).toContain('dist/index.js')
	})

	it('reports doctor diagnostics from the default Rust MCP entrypoint', () => {
		const result = spawnSync(rustServerBin, ['doctor'], {
			cwd: repoRoot,
			encoding: 'utf8',
		})
		const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
		expect(output).toContain('Rust MCP server')
		expect(output).toContain('engine cli')
	})
})
