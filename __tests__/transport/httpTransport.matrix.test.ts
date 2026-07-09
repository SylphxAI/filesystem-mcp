import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('web MCP HTTP transport routing', () => {
	it('bin wrapper routes MCP_TRANSPORT=http to Rust rmcp server', () => {
		const bin = readFileSync(path.join(repoRoot, 'bin/filesystem-mcp'), 'utf8')
		expect(bin).toContain('resolve_transport')
		expect(bin).toContain('MCP_TRANSPORT=http')
		expect(bin).toContain('FILESYSTEM_MCP_TRANSPORT=http')
	})

	it('Rust MCP server exposes streamable HTTP transport module', () => {
		const httpTransport = readFileSync(
			path.join(repoRoot, 'crates/filesystem-mcp-server/src/http_transport.rs'),
			'utf8',
		)
		const mainRs = readFileSync(
			path.join(repoRoot, 'crates/filesystem-mcp-server/src/main.rs'),
			'utf8',
		)
		expect(httpTransport).toContain('StreamableHttpService')
		expect(httpTransport).toContain('health_check')
		expect(mainRs).toContain('http_transport::serve_http')
	})
})