#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { z, ZodTypeAny } from 'zod'; // Import ZodTypeAny
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode, // Import CallToolRequest
  // ListToolsResponse is not exported, use inline type or define locally
} from '@modelcontextprotocol/sdk/types.js';
import type { McpToolResponse } from './handlers/index.js'; // Import shared type
// Import the aggregated tool definitions
import { allToolDefinitions } from './handlers/index.js';
// Removed incorrect import left over from partial diff

// --- Tool Names (Constants) ---
// Removed tool name constants, names are now in the definitions

// --- Server Setup ---

const server = new Server(
  {
    name: 'filesystem-mcp',
    version: '0.4.0', // Increment version for definition refactor
    description:
      'MCP Server for filesystem operations relative to the project root.',
  },
  {
    capabilities: { tools: {} },
  },
);

// Helper function to convert Zod schema to JSON schema for MCP
// Use ZodTypeAny and a more specific return type or any
const generateInputSchema = (schema: ZodTypeAny): Record<string, unknown> => {
  // Cast to any is still likely needed due to zodToJsonSchema's complex output
  return zodToJsonSchema(schema, { target: 'openApi3' }) as any;
};

// Remove async, add return type using imported ListToolsResponse
// Use inline type for the return value
server.setRequestHandler(
  ListToolsRequestSchema,
  (): {
    tools: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }[];
  } => {
    // Removed log
    // Map the aggregated definitions to the format expected by the SDK
    const availableTools = allToolDefinitions.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: generateInputSchema(def.schema), // Generate JSON schema from Zod schema
    }));
    return { tools: availableTools };
  },
);

// Add types for request and return value
server.setRequestHandler(CallToolRequestSchema, (async (
  request: CallToolRequest,
) => {
  // Use imported handlers
  // Find the tool definition by name and call its handler
  const toolDefinition = allToolDefinitions.find(
    (def) => def.name === request.params.name,
  );

  if (!toolDefinition) {
    throw new McpError(
      ErrorCode.MethodNotFound,
      `Unknown tool: ${request.params.name}`,
    );
  }

  // Call the handler associated with the found definition
  // The handler itself will perform Zod validation on the arguments
  return toolDefinition.handler(request.params.arguments);
}) as any); // Use 'as any' to bypass type checking issue

// --- Server Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Filesystem MCP] Server running on stdio');
}

main().catch((error: unknown) => {
  // Type catch variable as unknown
  console.error('[Filesystem MCP] Server error:', error);
  process.exit(1);
});
