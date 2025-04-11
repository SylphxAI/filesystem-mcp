#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodTypeAny } from 'zod'; // Keep ZodTypeAny
import { zodToJsonSchema } from 'zod-to-json-schema';
import { applyDiffInputSchema } from './schemas/apply-diff-schema.js';
// Import SDK types needed
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
// Import the LOCAL McpRequest/McpResponse types defined in handlers/index.ts
import type { ToolDefinition } from './handlers/index.js';
import type {
  McpRequest as LocalMcpRequest,
  McpToolResponse as LocalMcpResponse,
} from './types/mcp-types.js';
// Import the aggregated tool definitions
import { allToolDefinitions } from './handlers/index.js';

// --- Server Setup ---

const server = new Server(
  {
    name: 'filesystem-mcp',
    version: '0.6.0', // Version bump for apply_diff tool
    description: 'MCP Server for filesystem operations relative to the project root.',
  },
  {
    capabilities: { tools: {} },
  },
);

// Helper function to convert Zod schema to JSON schema for MCP
const generateInputSchema = (schema: ZodTypeAny): Record<string, unknown> => {
  // Pass ZodTypeAny directly

  return zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown>;
};

// Set request handler for listing tools
server.setRequestHandler(
  ListToolsRequestSchema,
  (): {
    tools: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }[];
  } => {
    // Map the aggregated definitions to the format expected by the SDK
    const availableTools = allToolDefinitions.map((def) => {
      if (typeof def === 'function') {
        // Handle function-based tools (like handleApplyDiff)
        return {
          name: 'apply_diff',
          description: 'Apply diffs to files',
          inputSchema: generateInputSchema(applyDiffInputSchema),
        };
      }
      return {
        name: def.name,
        description: def.description,
        inputSchema: generateInputSchema(def.inputSchema),
      };
    });
    return { tools: availableTools };
  },
);

// --- Helper Functions for handleCallTool ---

/** Handles errors from the local tool handler response. */
function handleToolError(localResponse: LocalMcpResponse): void {
  // Use optional chaining for safer access
  if (localResponse.error) {
    throw localResponse.error instanceof McpError
      ? localResponse.error
      : new McpError(ErrorCode.InternalError, 'Handler returned an unexpected error format.');
  }
}

/** Formats the successful response payload from the local tool handler. */
function formatSuccessPayload(localResponse: LocalMcpResponse): Record<string, unknown> {
  // Check for data property safely
  if (localResponse.data && typeof localResponse.data === 'object') {
    // Assert type for safety, assuming data is the primary payload
    return localResponse.data as Record<string, unknown>;
  }
  // Check for content property safely
  if (localResponse.content && Array.isArray(localResponse.content)) {
    // Assuming if it's an array, the structure is correct based on handler return types
    // Removed the .every check causing the unnecessary-condition error
    return { content: localResponse.content };
  }
  // Return empty object if no specific data or valid content found
  return {};
}

// --- Main Handler for Tool Calls ---

/** Handles incoming 'call_tool' requests from the SDK. */
const handleCallTool = async (sdkRequest: CallToolRequest): Promise<Record<string, unknown>> => {
  // Find the corresponding tool definition

  const toolDefinition: ToolDefinition | undefined = allToolDefinitions.find(
    (def) => def.name === sdkRequest.params.name,
  );

  // Throw error if tool is not found
  if (!toolDefinition) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${sdkRequest.params.name}`);
  }

  // Construct the request object expected by the local handler
  const localRequest: LocalMcpRequest = {
    jsonrpc: '2.0',
    method: sdkRequest.method,
    params: sdkRequest.params,
  };

  // Execute the local tool handler
  const localResponse: LocalMcpResponse = await toolDefinition.handler(localRequest);

  // Process potential errors from the handler
  handleToolError(localResponse);

  // Format and return the success payload
  return formatSuccessPayload(localResponse);
};

// Register the main handler function with the SDK server
server.setRequestHandler(CallToolRequestSchema, handleCallTool);

// --- Server Start ---

try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server started successfully
} catch {
  // Server failed to start
  process.exit(1);
}
