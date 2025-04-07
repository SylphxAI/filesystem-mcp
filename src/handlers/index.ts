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
import type { ZodType } from 'zod'; // Removed unused 'z' import
import type { McpRequest, McpResponse } from '@modelcontextprotocol/sdk'; // Use import type

// Define the structure for a tool definition
// Matches the structure in individual tool files like applyDiff.ts
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  // Default to unknown
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  outputSchema?: ZodType<TOutput>; // Output schema is optional
  handler: (request: McpRequest<TInput>) => Promise<McpResponse<TOutput>>;
}

// Aggregate all tool definitions into a single array
export const allToolDefinitions: ToolDefinition[] = [
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
