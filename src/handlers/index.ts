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
import { editFileDefinition } from './editFile.js';

// Define the structure for a tool definition (used internally and for index.ts)
// We need Zod here to define the schema type correctly
import type { z } from 'zod';

// Define and export the expected MCP response structure
export interface McpToolResponse {
  // Add export keyword
  content: { type: string; text: string }[];
}

// Define the structure for a tool definition
export interface ToolDefinition {
  name: string;
  description: string;

  schema: z.ZodTypeAny; // Use ZodTypeAny and disable lint rule
  handler: (args: unknown) => Promise<McpToolResponse>; // Use specific return type
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
  editFileDefinition,
];
