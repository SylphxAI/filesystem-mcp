import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

/** Zod 4 uses `.issues`; older handlers assumed `.errors`. Normalize both. */
export function formatZodIssues(error: z.ZodError): string {
	const anyErr = error as z.ZodError & {
		errors?: readonly { path: PropertyKey[]; message: string }[]
	}
	const issues = anyErr.issues ?? anyErr.errors ?? []
	return issues.map((e) => `${e.path.map(String).join('.')} (${e.message})`).join(', ')
}

export function mcpErrorFromZod(error: unknown, fallback = 'Argument validation failed'): never {
	if (error instanceof z.ZodError) {
		const detail = formatZodIssues(error)
		throw new McpError(ErrorCode.InvalidParams, detail ? `Invalid arguments: ${detail}` : fallback)
	}
	throw new McpError(ErrorCode.InvalidParams, fallback)
}
