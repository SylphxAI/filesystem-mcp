import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..')

const CAPABILITY_IDS = [
	'transport/web-mcp-http',
	'transport/stdio-rust-rmcp',
	'transport/stdio-ts-adapter',
	'tool/list_files',
	'tool/search_files',
	'tool/read_content',
	'tool/write_content',
	'tool/stat_items',
	'tool/delete_items',
	'tool/create_directories',
	'tool/chmod_items',
	'tool/chown_items',
	'tool/move_items',
	'tool/copy_items',
	'tool/replace_content',
	'tool/apply_diff',
] as const

describe('TS stdio adapter deletion matrix (adversarial admission)', () => {
	it('npm bin routes exclusively to Rust rmcp', () => {
		const bin = readFileSync(path.join(repoRoot, 'bin/filesystem-mcp'), 'utf8')
		expect(bin).toContain('resolve_rust_bin')
		expect(bin).toContain('resolve_transport')
		expect(bin).toContain('filesystem-mcp-server')
		expect(bin).not.toContain('use_ts_transport')
		expect(bin).not.toContain('exec node')
		expect(bin).not.toContain('dist/index.js')
		expect(bin).toContain('is_runnable_native')
		expect(bin).toContain('resolve_from_optional_dep')
	})

	it('TS stdio adapter sources are deleted', () => {
		expect(existsSync(path.join(repoRoot, 'src/index.ts'))).toBe(false)
		expect(existsSync(path.join(repoRoot, 'dist/index.js'))).toBe(false)
	})

	it('doctor CLI is preserved via doctor-cli.ts (not src/index.ts)', () => {
		expect(existsSync(path.join(repoRoot, 'src/doctor-cli.ts'))).toBe(true)
		const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>
		}
		expect(pkg.scripts?.doctor).toContain('doctor-cli')
		expect(pkg.scripts?.doctor).not.toContain('src/index.ts')
	})

	it('deletion gate script enforces ts_deleted ledger state', () => {
		const script = readFileSync(path.join(repoRoot, 'scripts/check-ts-adapter-deletion-ready.sh'), 'utf8')
		expect(script).toContain('require_ledger_state "transport/stdio-ts-adapter" "ts_deleted"')
		expect(script).toContain('src/index.ts must be deleted')
		expect(script).toContain('use_ts_transport')
	})

	it('check-no-ts-stdio-mcp gate enforces Rust-only stdio authority', () => {
		const script = readFileSync(path.join(repoRoot, 'scripts/check-no-ts-stdio-mcp.sh'), 'utf8')
		expect(script).toContain('check-no-ts-stdio-mcp')
		expect(script).toContain('resolve_rust_bin')
		expect(script).toContain('transport::stdio')
		expect(script).toContain('transport/stdio-ts-adapter')
		expect(script).toContain('ts_deleted')
	})

	it('ledger records all capabilities as ts_deleted', () => {
		const ledger = JSON.parse(readFileSync(path.join(repoRoot, 'docs/specs/migration-ledger.json'), 'utf8')) as {
			capabilities: Array<{ id: string; state: string }>
			summary: { ts_deleted: number; ts_only: number; completion_progress: number; total: number }
		}
		expect(ledger.capabilities).toHaveLength(16)
		for (const id of CAPABILITY_IDS) {
			const cap = ledger.capabilities.find((entry) => entry.id === id)
			expect(cap?.state, id).toBe('ts_deleted')
		}
		expect(ledger.summary.ts_deleted).toBe(16)
		expect(ledger.summary.ts_only).toBe(0)
		expect(ledger.summary.completion_progress).toBe(1.0)
		expect(ledger.summary.total).toBe(16)
	})

	it('deletion-ready and no-ts-stdio gates pass against real bin + ledger', () => {
		const deletion = spawnSync('bash', ['scripts/check-ts-adapter-deletion-ready.sh'], {
			cwd: repoRoot,
			encoding: 'utf8',
			timeout: 30_000,
		})
		expect(deletion.status).toBe(0)
		expect(deletion.stdout).toContain('PASS')

		const noTs = spawnSync('bash', ['scripts/check-no-ts-stdio-mcp.sh'], {
			cwd: repoRoot,
			encoding: 'utf8',
			timeout: 30_000,
		})
		expect(noTs.status).toBe(0)
		expect(noTs.stdout).toContain('PASS')
	})
})
