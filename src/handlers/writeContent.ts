// src/handlers/writeContent.ts
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

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

export const WriteContentArgsSchema = z
  .object({
    items: z
      .array(WriteItemSchema)
      .min(1, { message: 'Items array cannot be empty' })
      .describe('Array of {path, content, append?} objects.'),
  })
  .strict();

type WriteContentArgs = z.infer<typeof WriteContentArgsSchema>;
type WriteItem = z.infer<typeof WriteItemSchema>; // Define type for item

interface WriteResult {
  path: string;
  success: boolean;
  operation?: 'written' | 'appended';
  error?: string;
}

export interface WriteContentDependencies {
  writeFile: typeof fs.writeFile;
  mkdir: typeof fs.mkdir;
  stat: typeof fs.stat; // Keep stat if needed for future checks, though not used now
  appendFile: typeof fs.appendFile;
  resolvePath: typeof resolvePath;
  PROJECT_ROOT: string;
  pathDirname: (p: string) => string;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): WriteContentArgs {
  try {
    return WriteContentArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
      throw new McpError(
        ErrorCode.InvalidParams, // eslint-disable-line @typescript-eslint/no-unsafe-member-access
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed'); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
  }
}

/** Handles errors during file write/append operation. */
function handleWriteError(
  error: unknown,
  relativePath: string,
  pathOutput: string,
  append: boolean,
): WriteResult {
  if (error instanceof McpError) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    return { path: pathOutput, success: false, error: error.message };
  }
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(
    `[Filesystem MCP - writeContent] Error ${append ? 'appending to' : 'writing'} file ${relativePath}:`,
    error,
  );
  return {
    path: pathOutput,
    success: false,
    error: `Failed to ${append ? 'append' : 'write'} file: ${errorMessage}`,
  };
}

/** Processes a single write/append operation. */
async function processSingleWriteOperation(
  file: WriteItem,
  deps: WriteContentDependencies,
): Promise<WriteResult> {
  const relativePath = file.path;
  const content = file.content;
  const append = file.append;
  const pathOutput = relativePath.replace(/\\/g, '/');

  try {
    const targetPath = deps.resolvePath(relativePath);
    if (targetPath === deps.PROJECT_ROOT) {
      return {
        path: pathOutput,
        success: false,
        error: 'Writing directly to the project root is not allowed.',
      };
    }
    const targetDir = deps.pathDirname(targetPath);
    // Avoid creating the root dir itself
    if (targetDir !== deps.PROJECT_ROOT) {
      await deps.mkdir(targetDir, { recursive: true });
    }

    if (append) {
      await deps.appendFile(targetPath, content, 'utf-8');
      return { path: pathOutput, success: true, operation: 'appended' };
    } else {
      await deps.writeFile(targetPath, content, 'utf-8');
      return { path: pathOutput, success: true, operation: 'written' };
    }
  } catch (error: unknown) {
    return handleWriteError(error, relativePath, pathOutput, append);
  }
}

/** Processes results from Promise.allSettled. */
function processSettledResults(
  results: PromiseSettledResult<WriteResult>[],
  originalItems: WriteItem[],
): WriteResult[] {
  return results.map((result, index) => {
    const originalItem = originalItems[index];
    const pathOutput = (originalItem?.path ?? 'unknown_path').replace(
      /\\/g,
      '/',
    );

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - writeContent] Unexpected rejection for path ${pathOutput}:`,
        result.reason,
      );
      return {
        path: pathOutput,
        success: false,
        error: `Unexpected error during processing: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      };
    }
  });
}

/** Main handler function */
export const handleWriteContentFunc = async (
  // Added export
  deps: WriteContentDependencies,
  args: unknown,
): Promise<McpToolResponse> => {
  const { items: filesToWrite } = parseAndValidateArgs(args);

  const writePromises = filesToWrite.map((file) =>
    processSingleWriteOperation(file, deps),
  );
  const settledResults = await Promise.allSettled(writePromises);

  const outputResults = processSettledResults(settledResults, filesToWrite);

  // Sort results based on the original order
  const originalIndexMap = new Map(
    filesToWrite.map((f, i) => [f.path.replace(/\\/g, '/'), i]),
  );
  outputResults.sort((a, b) => {
    const indexA = originalIndexMap.get(a.path) ?? Infinity;
    const indexB = originalIndexMap.get(b.path) ?? Infinity;
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
  handler: (args: unknown): Promise<McpToolResponse> => {
    const deps: WriteContentDependencies = {
      writeFile: fs.writeFile,
      mkdir: fs.mkdir,
      stat: fs.stat,
      appendFile: fs.appendFile,
      resolvePath: resolvePath,
      PROJECT_ROOT: PROJECT_ROOT,
      pathDirname: path.dirname.bind(path),
    };
    return handleWriteContentFunc(deps, args);
  },
};
