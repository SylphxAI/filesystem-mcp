import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js'; // Restore PROJECT_ROOT import

// Define the expected MCP response structure locally
interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

/**
 * Handles the 'write_content' MCP tool request.
 * Writes or appends content to multiple specified files.
 */
// Removed extra comment marker

// Define Zod schema for individual items and export it
export const WriteItemSchema = z
  .object({
    path: z.string().describe('Relative path for the file.'),
    content: z.string().describe('Content to write.'),
    append: z
      .boolean()
      .optional()
      .default(false)
      .describe('Append content instead of overwriting.'),
  })
  .strict();

// Define Zod schema for the main arguments object and export it
export const WriteContentArgsSchema = z
  .object({
    items: z
      .array(WriteItemSchema)
      .min(1, { message: 'Items array cannot be empty' })
      .describe('Array of {path, content, append?} objects.'),
  })
  .strict();

// Infer TypeScript type
type WriteContentArgs = z.infer<typeof WriteContentArgsSchema>;
// Removed duplicated non-exported schema/type definitions comment

// Define Dependencies Interface
export interface WriteContentDependencies {
  writeFile: typeof fs.writeFile;
  mkdir: typeof fs.mkdir;
  stat: typeof fs.stat;
  appendFile: typeof fs.appendFile;
  resolvePath: typeof resolvePath;
  PROJECT_ROOT: string;
  path: Pick<typeof path, 'dirname'>; // Only dirname is used
}

export const handleWriteContentFunc = async (
  deps: WriteContentDependencies,
  args: unknown,
): Promise<McpToolResponse> => {
  // Add return type
  // Validate and parse arguments
  let parsedArgs: WriteContentArgs;
  try {
    parsedArgs = WriteContentArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
  const { items: filesToWrite } = parsedArgs;

  // Define result structure
  interface WriteResult {
    path: string;
    success: boolean;
    operation?: 'written' | 'appended';
    error?: string;
  }

  const results = await Promise.allSettled(
    filesToWrite.map(async (file): Promise<WriteResult> => {
      const relativePath = file.path;
      const content = file.content;
      const append = file.append ?? false; // Check for append flag
      const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early

      try {
        const targetPath = deps.resolvePath(relativePath);
        if (targetPath === deps.PROJECT_ROOT) {
          return {
            path: pathOutput,
            success: false,
            error: 'Writing directly to the project root is not allowed.',
          };
        }
        const targetDir = deps.path.dirname(targetPath);
        await deps.mkdir(targetDir, { recursive: true });

        if (append) {
          await deps.appendFile(targetPath, content, 'utf-8');
          return { path: pathOutput, success: true, operation: 'appended' };
        } else {
          await deps.writeFile(targetPath, content, 'utf-8');
          return { path: pathOutput, success: true, operation: 'written' };
        }
      } catch (error: any) {
        if (error instanceof McpError) {
          return { path: pathOutput, success: false, error: error.message };
        }
        console.error(
          `[Filesystem MCP - writeContent] Error writing file ${relativePath}:`,
          error,
        );
        return {
          path: pathOutput,
          success: false,
          error: `Failed to ${append ? 'append' : 'write'} file: ${error.message}`,
        };
      }
    }),
  );

  // Process results from Promise.allSettled
  const outputResults: WriteResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - writeContent] Unexpected rejection for path ${filesToWrite[index]?.path}:`,
        result.reason,
      );
      return {
        path: (filesToWrite[index]?.path ?? 'unknown_path').replace(/\\/g, '/'), // Handle potential undefined
        success: false,
        error: 'Unexpected error during processing.',
      };
    }
  });

  // Sort results by original path order for predictability
  // Sort results based on the original order in the input 'items' array
  outputResults.sort((a, b) => {
    const indexA = filesToWrite.findIndex(
      (f) => f.path.replace(/\\/g, '/') === (a.path ?? ''),
    );
    const indexB = filesToWrite.findIndex(
      (f) => f.path.replace(/\\/g, '/') === (b.path ?? ''),
    );
    // Handle cases where path might be missing in error results (though unlikely)
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(outputResults, null, 2) }],
  };
};

// Export the complete tool definition
export const writeContentToolDefinition = {
  name: 'write_content',
  description:
    "Write or append content to multiple specified files (creating directories if needed). NOTE: For modifying existing files, prefer using 'edit_file' or 'replace_content' for better performance, especially with large files. Use 'write_content' primarily for creating new files or complete overwrites.",
  schema: WriteContentArgsSchema,
  // The production handler needs to provide the dependencies
  handler: (args: unknown) => {
    const deps: WriteContentDependencies = {
      writeFile: fs.writeFile,
      mkdir: fs.mkdir,
      stat: fs.stat,
      appendFile: fs.appendFile,
      resolvePath: resolvePath,
      PROJECT_ROOT: PROJECT_ROOT,
      path: { dirname: path.dirname },
    };
    return handleWriteContentFunc(deps, args);
  },
};
