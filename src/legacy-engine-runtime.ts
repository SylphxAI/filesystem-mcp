#!/usr/bin/env node
/**
 * Legacy MCP engine runtime invoked only through filesystem-cli.
 * Not an MCP adapter — Rust rmcp owns MCP protocol; this script is temporary
 * migration glue until all filesystem tools live in Rust core.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { allToolDefinitions } from './handlers/index.js'
import type { McpToolResponse } from './types/mcp-types.js'

type LegacyEngineRequest = {
	tool: string
	arguments: unknown
}

const readStdin = async (): Promise<string> => {
	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}
	return Buffer.concat(chunks).toString('utf8')
}

const toCallToolResult = (response: McpToolResponse): CallToolResult => ({
	content: response.content,
	...(response.error ? { isError: true as const } : {}),
})

async function main(): Promise<void> {
	const payload = await readStdin()
	const request = JSON.parse(payload) as LegacyEngineRequest
	const definition = allToolDefinitions.find((entry) => entry.name === request.tool)

	if (!definition) {
		console.log(
			JSON.stringify({
				content: [{ type: 'text', text: `Unsupported legacy engine tool: ${request.tool}` }],
				isError: true,
			} satisfies CallToolResult),
		)
		return
	}

	try {
		const result = await definition.handler(request.arguments)
		console.log(JSON.stringify(toCallToolResult(result)))
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error)
		console.log(
			JSON.stringify({
				content: [{ type: 'text', text: message }],
				isError: true,
			} satisfies CallToolResult),
		)
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error)
	console.log(
		JSON.stringify({
			content: [{ type: 'text', text: `Legacy engine runtime failed: ${message}` }],
			isError: true,
		} satisfies CallToolResult),
	)
	process.exit(1)
})