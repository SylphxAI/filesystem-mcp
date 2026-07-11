/**
 * Publish multi-arch platform packages (optionalDependencies) to npm.
 *
 * Fail-closed: every npm/<platform>/ directory must contain package.json +
 * a non-trivial executable filesystem-mcp-server binary.
 *
 * Intended to run after assemble-multiarch-natives + sync-platform-versions,
 * and before `changeset publish` for the main package.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const platformRoot = path.join(repoRoot, 'npm')
const binaryName = 'filesystem-mcp-server'
const minBytes = 100_000

if (!fs.existsSync(platformRoot)) {
	console.error('[publish-platform-packages] npm/ directory missing')
	process.exit(1)
}

const platforms = fs
	.readdirSync(platformRoot, { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name)
	.sort()

if (platforms.length === 0) {
	console.error('[publish-platform-packages] No platform packages under npm/')
	process.exit(1)
}

function packageExists(name: string, version: string): boolean {
	const view = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json'], {
		encoding: 'utf8',
	})
	if (view.status === 0) {
		const raw = (view.stdout || '').trim()
		try {
			const parsed = JSON.parse(raw) as string | string[]
			if (typeof parsed === 'string') return parsed === version
			if (Array.isArray(parsed)) return parsed.includes(version)
		} catch {
			return raw.replace(/"/g, '') === version
		}
	}

	// Tarball HEAD fallback (packument lag)
	// Encode every "/" for the npm registry path (scoped packages are @scope/name).
	const scopedPath = name.startsWith('@') ? name.split('/').join('%2f') : name
	const shortName = name.includes('/') ? (name.split('/')[1] ?? name) : name
	const url = `https://registry.npmjs.org/${scopedPath}/-/${shortName}-${version}.tgz`
	const head = spawnSync(
		'curl',
		['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-L', '-I', url],
		{ encoding: 'utf8' },
	)
	return head.status === 0 && (head.stdout || '').trim().split('\n').pop() === '200'
}

let published = 0
let skipped = 0

for (const platform of platforms) {
	const dir = path.join(platformRoot, platform)
	const pkgPath = path.join(dir, 'package.json')
	const binPath = path.join(dir, binaryName)

	if (!fs.existsSync(pkgPath)) {
		console.error(`[publish-platform-packages] MISSING package.json in ${dir}`)
		process.exit(1)
	}
	if (!fs.existsSync(binPath)) {
		console.error(`[publish-platform-packages] MISSING ${binaryName} in ${dir}`)
		process.exit(1)
	}
	const size = fs.statSync(binPath).size
	if (size < minBytes) {
		console.error(
			`[publish-platform-packages] ${binPath} too small (${size} bytes); assemble natives first`,
		)
		process.exit(1)
	}
	fs.chmodSync(binPath, 0o755)

	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name: string; version: string }
	console.log(`[publish-platform-packages] ${pkg.name}@${pkg.version} (${platform}, ${size} bytes)`)

	if (packageExists(pkg.name, pkg.version)) {
		console.log(`[publish-platform-packages] SKIP already published ${pkg.name}@${pkg.version}`)
		skipped++
		continue
	}

	const result = spawnSync(
		'npm',
		['publish', '--access', 'public', '--registry', 'https://registry.npmjs.org/'],
		{
			cwd: dir,
			encoding: 'utf8',
			env: process.env,
			stdio: 'inherit',
		},
	)
	if (result.status !== 0) {
		console.error(`[publish-platform-packages] FAIL npm publish ${pkg.name}@${pkg.version}`)
		process.exit(result.status ?? 1)
	}
	published++
	console.log(`[publish-platform-packages] OK ${pkg.name}@${pkg.version}`)
}

console.log(
	`[publish-platform-packages] Done: published=${published} skipped=${skipped} total=${platforms.length}`,
)
