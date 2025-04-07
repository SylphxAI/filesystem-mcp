// src/handlers/deleteItems.ts
import { promises as fs } from 'fs';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

export const DeleteItemsArgsSchema = z
  .object({
    paths: z
      .array(z.string())
      .min(1, { message: 'Paths array cannot be empty' })
      .describe('An array of relative paths (files or directories) to delete.'),
  })
  .strict();

type DeleteItemsArgs = z.infer<typeof DeleteItemsArgsSchema>;

interface DeleteResult {
  path: string;
  success: boolean;
  note?: string;
  error?: string;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): DeleteItemsArgs {
  try {
    return DeleteItemsArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
}

/** Determines the error message and whether to log based on the error type. */
function getErrorInfo(
  error: unknown,
  relativePath: string,
): { message: string; log: boolean } {
  // Default error message and assume logging is needed
  let errorMessage = `Failed to delete: ${error instanceof Error ? error.message : String(error)}`;
  let logError = true;

  // Handle specific known error types
  if (error instanceof McpError) {
    errorMessage = error.message;
    logError = false; // Assume McpError was logged at source or is expected
  } else if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (code === 'ENOENT') {
      // This case is handled separately in processSingleDeleteOperation,
      // but include check here for completeness if called elsewhere.
      errorMessage = 'Path not found';
      logError = false;
    } else if (code === 'EPERM' || code === 'EACCES') {
      errorMessage = `Permission denied deleting ${relativePath}`;
      // Keep logError = true for permission issues
    }
  }

  return { message: errorMessage, log: logError };
}

/** Handles errors during delete operation. */
function handleDeleteError(
  error: unknown,
  relativePath: string,
  pathOutput: string,
): DeleteResult {
  // If the path doesn't exist, consider it a "successful" deletion.
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  ) {
    return {
      path: pathOutput,
      success: true,
      note: 'Path not found, nothing to delete',
    };
  }

  const { message: errorMessage, log: logError } = getErrorInfo(
    error,
    relativePath,
  );

  if (logError) {
    console.error(
      `[Filesystem MCP - deleteItems] Error deleting item ${relativePath}:`,
      error,
    );
  }

  return { path: pathOutput, success: false, error: errorMessage };
}

/** Processes the deletion of a single item. */
async function processSingleDeleteOperation(
  relativePath: string,
): Promise<DeleteResult> {
  const pathOutput = relativePath.replace(/\\/g, '/');
  try {
    const targetPath = resolvePath(relativePath);
    if (targetPath === PROJECT_ROOT) {
      return {
        path: pathOutput,
        success: false,
        error: 'Deleting the project root is not allowed.',
      };
    }
    // Use fs.rm which handles files and directories recursively
    await fs.rm(targetPath, { recursive: true, force: false }); // force: false allows ENOENT to be thrown
    return { path: pathOutput, success: true };
  } catch (error: unknown) {
    // Pass the error to the dedicated handler
    return handleDeleteError(error, relativePath, pathOutput);
  }
}

/** Processes results from Promise.allSettled. Exported for testing. */
export function processSettledResults( // Add export
  results: PromiseSettledResult<DeleteResult>[],
  originalPaths: string[],
): DeleteResult[] {
  return results.map((result, index) => {
    const originalPath = originalPaths[index] ?? 'unknown_path';
    const pathOutput = originalPath.replace(/\\/g, '/');

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - deleteItems] Unexpected rejection for path ${originalPath}:`,
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
const handleDeleteItemsFunc = async (
  args: unknown,
): Promise<McpToolResponse> => {
  const { paths: pathsToDelete } = parseAndValidateArgs(args);

  const deletePromises = pathsToDelete.map(processSingleDeleteOperation);
  const settledResults = await Promise.allSettled(deletePromises);

  const outputResults = processSettledResults(settledResults, pathsToDelete);

  // Sort results by original path order for predictability
  const originalIndexMap = new Map(
    pathsToDelete.map((p, i) => [p.replace(/\\/g, '/'), i]),
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
export const deleteItemsToolDefinition = {
  name: 'delete_items',
  description: 'Delete multiple specified files or directories.',
  schema: DeleteItemsArgsSchema,
  handler: handleDeleteItemsFunc,
};
