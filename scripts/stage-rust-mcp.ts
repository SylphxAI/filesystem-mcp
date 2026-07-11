import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const source = path.join(repoRoot, 'target/release/filesystem-mcp-server')
const targetDir = path.join(repoRoot, 'bin/native')
const target = path.join(targetDir, 'filesystem-mcp-server')

function hostPlatformDir(): string | null {
	const platform = os.platform()
	const arch = os.arch()
	if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
	if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
	if (platform === 'linux' && arch === 'x64') return 'linux-x64-gnu'
	if (platform === 'linux' && arch === 'arm64') return 'linux-arm64-gnu'
	return null
}

if (!fs.existsSync(source)) {
	console.error(`[stage-rust-mcp] Missing release binary at ${source}. Run: bun run build:rust`)
	process.exit(1)
}

fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, target)
fs.chmodSync(target, 0o755)
console.log(`[stage-rust-mcp] Staged ${target}`)

// Also stage host platform optionalDependency package binary for local smoke.
const platformDir = hostPlatformDir()
if (platformDir) {
	const platformTarget = path.join(repoRoot, 'npm', platformDir, 'filesystem-mcp-server')
	fs.mkdirSync(path.dirname(platformTarget), { recursive: true })
	fs.copyFileSync(source, platformTarget)
	fs.chmodSync(platformTarget, 0o755)
	console.log(`[stage-rust-mcp] Staged platform package binary ${platformTarget}`)
}
