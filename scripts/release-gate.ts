import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runDoctor } from '../src/doctor.js'

const ARTIFACT_DIR_ENV = 'MCP_FILESYSTEM_BENCHMARK_OUTPUT_DIR'
const DEFAULT_ARTIFACT_DIR = 'benchmark-artifacts'
const ARTIFACT_FILE = 'filesystem_release_gate.json'

type GateStatus = 'passed' | 'failed'

interface GateCheck {
	id: string
	status: GateStatus
	message: string
	evidence?: Record<string, unknown>
}

interface ReleaseGateReport {
	profile: 'filesystem_release_gate'
	generated_at: string
	artifact_dir: string
	status: GateStatus
	summary: { total: number; passed: number; failed: number }
	checks: GateCheck[]
}

const repoRoot = path.resolve(import.meta.dirname, '..')

const addCheck = (
	checks: GateCheck[],
	id: string,
	passed: boolean,
	message: string,
	evidence?: Record<string, unknown>,
): void => {
	checks.push({
		id,
		status: passed ? 'passed' : 'failed',
		message,
		...(evidence ? { evidence } : {}),
	})
}

const fileExists = (relativePath: string): boolean => existsSync(path.join(repoRoot, relativePath))

const readJson = (relativePath: string): unknown =>
	JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'))

export function buildReleaseGateReport(artifactDir: string): ReleaseGateReport {
	const checks: GateCheck[] = []
	const pkg = readJson('package.json') as { version: string; bin?: Record<string, string> }
	const manifest = readJson('test/fixtures/safety-corpus-manifest.json') as {
		profile: string
		cases: Array<{ id: string }>
	}

	addCheck(
		checks,
		'package:filesystem_bin',
		typeof pkg.bin?.['filesystem-mcp'] === 'string',
		'package.json exposes the filesystem-mcp bin entry',
		{ bin: pkg.bin?.['filesystem-mcp'] },
	)

	addCheck(
		checks,
		'rust:workspace',
		fileExists('Cargo.toml') && fileExists('crates/filesystem-core/src/lib.rs'),
		'Rust filesystem-core policy crate is present',
	)

	addCheck(
		checks,
		'rust:search_engine',
		fileExists('crates/filesystem-core/src/search.rs'),
		'Rust filesystem-core search engine module is present',
	)

	addCheck(
		checks,
		'rust:walk_engine',
		fileExists('crates/filesystem-core/src/walk.rs'),
		'Rust filesystem-core directory walk engine module is present',
	)

	addCheck(
		checks,
		'rust:audit_engine',
		fileExists('crates/filesystem-core/src/audit.rs'),
		'Rust filesystem-core write audit ledger module is present',
	)

	addCheck(
		checks,
		'rust:mcp_server',
		fileExists('crates/filesystem-mcp-server/src/lib.rs'),
		'Rust MCP server (modelcontextprotocol/rust-sdk rmcp) is present',
	)

	const matrixProbe = spawnSync('bun', ['test', '__tests__/engine/shippedPath.matrix.test.ts'], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			FILESYSTEM_ALLOW_LEGACY_ENGINE: '',
		},
		timeout: 300_000,
	})
	addCheck(
		checks,
		'boundary:rust_cli_engine',
		!fileExists('src/engine-invoke.ts') && matrixProbe.status === 0,
		'Shipped-path matrix test proves Rust-core tools route without legacy runtime',
		matrixProbe.status === 0
			? { exitCode: 0 }
			: {
					exitCode: matrixProbe.status,
					stderr: matrixProbe.stderr?.slice(-2000),
					stdout: matrixProbe.stdout?.slice(-2000),
				},
	)

	const rustCli = path.join(repoRoot, 'target/release/filesystem-cli')
	const hashProbe = existsSync(rustCli)
		? spawnSync(rustCli, [], {
				input: JSON.stringify({ tool: 'content_hash', input: { content: 'audit-probe' } }),
				encoding: 'utf8',
			})
		: null
	const hashEnvelope =
		hashProbe && hashProbe.status === 0
			? (JSON.parse(hashProbe.stdout) as { status?: string; hash?: string })
			: undefined
	addCheck(
		checks,
		'boundary:rust_content_hash',
		hashEnvelope?.status === 'ok' && (hashEnvelope.hash?.length ?? 0) === 64,
		'Rust CLI content_hash returns a deterministic SHA-256 digest',
		{ hashLength: hashEnvelope?.hash?.length ?? 0 },
	)

	const auditProbe = existsSync(rustCli)
		? spawnSync(rustCli, [], {
				input: JSON.stringify({
					tool: 'record_write_audit',
					input: {
						root: repoRoot,
						tool: 'apply_diff',
						records: [
							{
								path: 'release-gate-probe.txt',
								beforeHash: hashEnvelope?.hash ?? '0'.repeat(64),
								afterHash: hashEnvelope?.hash ?? '0'.repeat(64),
								diffCount: 1,
								success: true,
								beforeContent: 'audit-probe',
							},
						],
					},
				}),
				encoding: 'utf8',
			})
		: null
	const auditEnvelope =
		auditProbe && auditProbe.status === 0
			? (JSON.parse(auditProbe.stdout) as {
					status?: string
					records?: Array<{
						rollback?: { available?: boolean; snapshotPath?: string }
					}>
				})
			: undefined
	addCheck(
		checks,
		'boundary:rollback_snapshot',
		auditEnvelope?.status === 'ok' &&
			auditEnvelope.records?.[0]?.rollback?.available === true &&
			(auditEnvelope.records?.[0]?.rollback?.snapshotPath?.includes('rollback/') ?? false),
		'record_write_audit stores rollback snapshots with restore metadata for successful writes',
		{
			rollbackAvailable: auditEnvelope?.records?.[0]?.rollback?.available,
			snapshotPath: auditEnvelope?.records?.[0]?.rollback?.snapshotPath,
		},
	)

	addCheck(
		checks,
		'fixtures:safety_corpus',
		manifest.profile === 'filesystem_safety_fixture_corpus' && manifest.cases.length >= 6,
		'Safety fixture corpus documents traversal, symlink, hidden, binary, and oversized cases',
		{ caseCount: manifest.cases.length },
	)

	addCheck(
		checks,
		'fixtures:safety_tree',
		fileExists('test/fixtures/safety/root/hidden/.secret') &&
			fileExists('test/fixtures/safety/root/binary/tiny.bin') &&
			fileExists('test/fixtures/safety/root/oversized/large.bin'),
		'Checked-in safety fixture tree includes hidden, binary, and oversized files',
	)

	for (const caseId of [
		'root-traversal',
		'sibling-prefix',
		'symlink-escape',
		'hidden-file',
		'binary-file',
		'oversized-file',
	]) {
		addCheck(
			checks,
			`fixtures:case:${caseId}`,
			manifest.cases.some((entry) => entry.id === caseId),
			`Safety corpus includes the ${caseId} case`,
		)
	}

	addCheck(
		checks,
		'examples:replace_content',
		fileExists('examples/replace-content-request.json'),
		'examples/replace-content-request.json documents a write-capable request shape',
	)

	addCheck(
		checks,
		'examples:apply_diff',
		fileExists('examples/apply-diff-request.json'),
		'examples/apply-diff-request.json documents diff-based edits',
	)

	const doctor = runDoctor(pkg.version)
	addCheck(
		checks,
		'doctor:node',
		doctor.checks.find((check) => check.id === 'node')?.status === 'ok',
		'doctor reports Node.js runtime is ready',
		{ doctorStatus: doctor.status },
	)

	const passed = checks.filter((check) => check.status === 'passed').length
	const failed = checks.length - passed

	return {
		profile: 'filesystem_release_gate',
		generated_at: new Date().toISOString(),
		artifact_dir: artifactDir,
		status: failed === 0 ? 'passed' : 'failed',
		summary: { total: checks.length, passed, failed },
		checks,
	}
}

function main(): void {
	const artifactDir = path.resolve(
		process.env[ARTIFACT_DIR_ENV] ?? path.join(repoRoot, DEFAULT_ARTIFACT_DIR),
	)

	const report = buildReleaseGateReport(artifactDir)
	mkdirSync(artifactDir, { recursive: true })
	const outputPath = path.join(artifactDir, ARTIFACT_FILE)
	writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
	console.error(`Filesystem release gate report written to ${outputPath}`)

	if (report.status !== 'passed') {
		for (const check of report.checks.filter((entry) => entry.status === 'failed')) {
			console.error(`[FAILED] ${check.id}: ${check.message}`)
		}
		process.exit(1)
	}
}

if (import.meta.main) {
	main()
}
