import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readText = (path: string) => readFileSync(path, 'utf8')

describe('README discovery surfaces', () => {
	it('keeps pain-first fold content and honest discovery status', () => {
		const readme = readText('README.md')

		expect(readme).toContain('Did it stay in the project?')
		expect(readme).toContain('## Why not shell commands?')
		expect(readme).toMatch(/Star the repo|Star this repo/)
		expect(readme).toContain('Not listed yet')
		expect(readme).toContain('glama.ai/mcp/servers/@sylphx/filesystem-mcp')
		expect(readme).toContain('read_content')
		expect(readme).toContain('docs/benchmark.md')
		expect(readme).not.toContain('- [ ] Performance benchmarks')
	})

	it('links benchmark docs from the VitePress site', () => {
		const vitepress = readText('docs/.vitepress/config.mts')

		expect(existsSync('docs/benchmark.md')).toBe(true)
		expect(vitepress).toContain('/benchmark')
	})
})
