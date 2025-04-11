// src/handlers/deleteItems.ts
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/path-utils.js';

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

/** Determines the error message based on the error type. */
function getErrorMessage(error: unknown, relativePath: string): string {
  if (error instanceof McpError) {
    return error.message;
  }
  if (error instanceof Error) {
    const errnoError = error as NodeJS.ErrnoException;
    if (errnoError.code) {
      // Don't handle ENOENT here
      if (errnoError.code === 'EPERM' || errnoError.code === 'EACCES') {
        return `Permission denied deleting ${relativePath}`;
      }
      return `Failed to delete ${relativePath}: ${error.message} (code: ${errnoError.code})`;
    }
    return `Failed to delete ${relativePath}: ${error.message}`;
  }
  return `Failed to delete ${relativePath}: ${String(error)}`;
}


/** Handles errors during delete operation. Revised logic again. */
function handleDeleteError(error: unknown, relativePath: string, pathOutput: string): DeleteResult {
  console.error(`[handleDeleteError] Received error for path "${relativePath}":`, JSON.stringify(error));

  // Check for McpError FIRST
  if (error instanceof McpError) {
      const errorMessage = getErrorMessage(error, relativePath);
      console.error(`[Filesystem MCP] McpError deleting ${relativePath}: ${errorMessage}`);
      console.error(`[handleDeleteError] Returning failure for "${relativePath}" (McpError): ${errorMessage}`);
      return { path: pathOutput, success: false, error: errorMessage };
  }

  // THEN check specifically for ENOENT
  const isENOENT =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT';

  if (isENOENT) {
    console.error(`[handleDeleteError] Detected ENOENT for "${relativePath}", returning success with note.`);
    return {
      path: pathOutput,
      success: true,
      note: 'Path not found, nothing to delete',
    };
  }

  // For ALL OTHER errors (including permission, generic), return failure
  const errorMessage = getErrorMessage(error, relativePath);
  console.error(`[Filesystem MCP] Other error deleting ${relativePath}: ${errorMessage}`);
  console.error(`[handleDeleteError] Returning failure for "${relativePath}" (Other Error): ${errorMessage}`);
  return { path: pathOutput, success: false, error: errorMessage };
}

/** Processes the deletion of a single item. */
async function processSingleDeleteOperation(relativePath: string): Promise<DeleteResult> {
  const pathOutput = relativePath.replaceAll('\\', '/');
  try {
    const targetPath = resolvePath(relativePath);
    if (targetPath === PROJECT_ROOT) {
      throw new McpError(ErrorCode.InvalidRequest, 'Deleting the project root is not allowed.');
    }
    await fs.rm(targetPath, { recursive: true, force: false });
    return { path: pathOutput, success: true };
  } catch (error: unknown) {
    // This catch block will now correctly pass McpError or other errors to handleDeleteError
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
    const pathOutput = originalPath.replaceAll('\\', '/');

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      // This case should ideally be less frequent now as errors are handled within safeProcessSingleDeleteOperation
      console.error(`[processSettledResults] Unexpected rejection for ${originalPath}:`, result.reason);
      // Pass rejection reason to the error handler
      return handleDeleteError(result.reason, originalPath, pathOutput);
    }
  });
}

/** Main handler function */
const handleDeleteItemsFunc = async (args: unknown): Promise<McpToolResponse> => {
  const { paths: pathsToDelete } = parseAndValidateArgs(args);

  const safeProcessSingleDeleteOperation = async (relativePath: string): Promise<DeleteResult> => {
     const pathOutput = relativePath.replaceAll('\\', '/');
     try {
       // Call the core logic which might return a DeleteResult or throw
       return await processSingleDeleteOperation(relativePath);
     } catch (error) {
       // Catch errors thrown *before* the try block in processSingleDeleteOperation (like resolvePath)
       // or unexpected errors within it not returning a DeleteResult.
       return handleDeleteError(error, relativePath, pathOutput);
     }
  };

  const deletePromises = pathsToDelete.map(safeProcessSingleDeleteOperation);
  const settledResults = await Promise.allSettled(deletePromises);

  const outputResults = processSettledResults(settledResults, pathsToDelete);

  // Sort results by original path order for predictability
  const originalIndexMap = new Map(pathsToDelete.map((p, i) => [p.replaceAll('\\', '/'), i]));
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
  inputSchema: DeleteItemsArgsSchema,
  handler: handleDeleteItemsFunc,
};
