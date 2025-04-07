#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodTypeAny } from 'zod'; // Removed unused 'z' import
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode, // Import CallToolRequest
  // ListToolsResponse is not exported, use inline type or define locally
} from '@modelcontextprotocol/sdk/types.js';
// Removed unused McpToolResponse import from './handlers/index.js'
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
// Specify return type more accurately, disable unsafe argument rule for this specific call
const generateInputSchema = (schema: ZodTypeAny): Record<string, unknown> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return zodToJsonSchema(schema, { target: 'openApi3' }) as Record<
    string,
    unknown
  >;
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
// Define the handler function separately with explicit types
const handleCallTool = async (
  request: CallToolRequest,
): Promise<{ content: { type: string; text: string }[] }> => {
  const toolDefinition = allToolDefinitions.find(
    (def) => def.name === request.params.name,
  );

  if (!toolDefinition) {
    throw new McpError(
      ErrorCode.MethodNotFound,
      `Unknown tool: ${request.params.name}`,
    );
  }
  // The handler itself returns Promise<McpToolResponse>, which matches the required return type
  return toolDefinition.handler(request.params.arguments);
};

// Register the typed handler function
server.setRequestHandler(CallToolRequestSchema, handleCallTool);

// --- Server Start ---

async function main(): Promise<void> {
  // Add return type
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Filesystem MCP] Server running on stdio');
}

main().catch((error: unknown) => {
  // Type catch variable as unknown
  console.error('[Filesystem MCP] Server error:', error);
  process.exit(1);
});
