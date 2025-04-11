import { listFilesToolDefinition } from './list-files.js';
import { statItemsToolDefinition } from './stat-items.js';
import { readContentToolDefinition } from './read-content.js';
import { writeContentToolDefinition } from './write-content.js';
import { deleteItemsToolDefinition } from './delete-items.js';
import { createDirectoriesToolDefinition } from './create-directories.js';
import { chmodItemsToolDefinition } from './chmod-items.js';
import { chownItemsToolDefinition } from './chown-items.js';
import { moveItemsToolDefinition } from './move-items.js';
import { copyItemsToolDefinition } from './copy-items.js';
import { searchFilesToolDefinition } from './search-files.js';
import { replaceContentToolDefinition } from './replace-content.js';
import { handleApplyDiff } from './apply-diff.js';
import { applyDiffInputSchema, ApplyDiffOutput } from '../schemas/apply-diff-schema.js';
import fs from 'node:fs';
import path from 'node:path';

// Define the structure for a tool definition (used internally and for index.ts)
import type { ZodType } from 'zod';
import type { McpToolResponse } from '../types/mcp-types.js';

// Define local interfaces based on usage observed in handlers
// Define the structure for a tool definition
// Matches the structure in individual tool files like applyDiff.ts
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  outputSchema?: ZodType<TOutput>;
  handler: (args: TInput) => Promise<McpToolResponse>; // Changed _args to args
}

// Helper type to extract input type from a tool definition
export type ToolInput<T extends ToolDefinition> =
  T extends ToolDefinition<infer I, unknown> ? I : never;

// Define a more specific type for our tool definitions to avoid naming conflicts
type HandlerToolDefinition = {
  name: string;
  description: string;
  inputSchema: ZodType<unknown>;
  outputSchema?: ZodType<unknown>;
  handler: (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
};

// Aggregate all tool definitions into a single array
// Use our more specific type to avoid naming conflicts
export const allToolDefinitions: HandlerToolDefinition[] = [
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
  {
    name: 'apply_diff',
    description: 'Apply diffs to files',
    inputSchema: applyDiffInputSchema,
    handler: async (args: unknown): Promise<McpToolResponse> => {
      const validatedArgs = applyDiffInputSchema.parse(args);
      const result: ApplyDiffOutput = await handleApplyDiff(validatedArgs.changes, {
        readFile: async (path: string) => fs.promises.readFile(path, 'utf8'),
        writeFile: async (path: string, content: string) =>
          fs.promises.writeFile(path, content, 'utf8'),
        path,
        projectRoot: process.cwd(),
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                results: result.results,
              },
              undefined,
              2,
            ),
          },
        ],
      };
    },
  },
];
