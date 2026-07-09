#!/usr/bin/env node
/**
 * Minimal API docs placeholder for VitePress build.
 * Full Typedoc generation can replace this when wired.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const apiDir = join(process.cwd(), 'docs', 'api')
const indexPath = join(apiDir, 'index.md')

mkdirSync(apiDir, { recursive: true })

if (!existsSync(indexPath)) {
	writeFileSync(
		indexPath,
		`# API Reference

Tool handlers are documented in the [repository README](https://github.com/SylphxAI/filesystem-mcp#-features).

Run \`bun run docs:api\` after wiring Typedoc to regenerate this page.
`,
	)
}