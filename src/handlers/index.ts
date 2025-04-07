import { listFilesToolDefinition } from './listFiles.js';
import { statItemsToolDefinition } from './statItems.js';
import { readContentToolDefinition } from './readContent.js';
import { writeContentToolDefinition } from './writeContent.js';
import { deleteItemsToolDefinition } from './deleteItems.js';
import { createDirectoriesToolDefinition } from './createDirectories.js';
import { chmodItemsToolDefinition } from './chmodItems.js';
import { chownItemsToolDefinition } from './chownItems.js';
import { moveItemsToolDefinition } from './moveItems.js';
import { copyItemsToolDefinition } from './copyItems.js';
import { searchFilesToolDefinition } from './searchFiles.js';
import { replaceContentToolDefinition } from './replaceContent.js';
import { applyDiffTool } from './applyDiff.js';

// Define the structure for a tool definition (used internally and for index.ts)
// We need Zod here to define the schema type correctly
import type { ZodType } from 'zod';
// Remove SDK imports for McpRequest/Response
// import type { McpRequest, McpResponse } from '@modelcontextprotocol/sdk/types.js';
import type { McpError } from '@modelcontextprotocol/sdk/types.js'; // Keep McpError import

// Define local interfaces based on usage observed in handlers
export interface McpRequest<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params: T;
  id?: string | number | null;
}

// Define a base McpResponse and specific ones if needed
export interface McpResponse<T = unknown> {
  jsonrpc?: '2.0';
  id?: string | number | null;
  success?: boolean; // Common pattern in handlers
  data?: T; // Common pattern in handlers
  error?: McpError;
  // Add other potential fields based on specific handler needs if necessary
  // For example, listFiles uses 'content'
  content?: { type: string; text: string }[];
}

// Define the structure for a tool definition
// Matches the structure in individual tool files like applyDiff.ts
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  // Default to unknown
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  outputSchema?: ZodType<TOutput>; // Output schema is optional
  // Use the locally defined types here
  handler: (request: McpRequest<TInput>) => Promise<McpResponse<TOutput>>;
}

// Aggregate all tool definitions into a single array
// Let TypeScript infer the type
export const allToolDefinitions = [
  listFilesToolDefinition,
  statItemsToolDefinition,
  readContentToolDefinition,
  writeContentToolDefinition,
  deleteItemsToolDefinition,
  createDirectoriesToolDefinition,
  chmodItemsToolDefinition,
  chownItemsToolDefinition,
  moveItemsToolDefinition,
  copyItemsToolDefinition,
  searchFilesToolDefinition,
  replaceContentToolDefinition,
  applyDiffTool,
];
