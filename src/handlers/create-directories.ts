// src/handlers/createDirectories.ts
import { promises as fs, type Stats } from 'node:fs'; // Import Stats type
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/path-utils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

export const CreateDirsArgsSchema = z
  .object({
    paths: z
      .array(z.string())
      .min(1, { message: 'Paths array cannot be empty' })
      .describe('An array of relative directory paths to create.'),
  })
  .strict();

type CreateDirsArgs = z.infer<typeof CreateDirsArgsSchema>;

interface CreateDirResult {
  path: string;
  success: boolean;
  note?: string;
  error?: string; // Added error field back
  resolvedPath?: string;
}

// --- Define Dependencies Interface ---
export interface CreateDirsDeps {
  mkdir: typeof fs.mkdir;
  stat: typeof fs.stat;
  resolvePath: typeof resolvePath;
  PROJECT_ROOT: string;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): CreateDirsArgs {
  try {
    return CreateDirsArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    // Throw a more specific error for non-Zod issues during parsing
    throw new McpError(
      ErrorCode.InvalidParams,
      `Argument validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Handles EEXIST errors by checking if the existing path is a directory. */
async function handleEexistError(
  targetPath: string,
  pathOutput: string,
  deps: CreateDirsDeps, // Added deps
): Promise<CreateDirResult> {
  try {
    const stats: Stats = await deps.stat(targetPath); // Use deps.stat
    return stats.isDirectory()
      ? {
          path: pathOutput,
          success: true,
          note: 'Directory already exists',
          resolvedPath: targetPath,
        }
      : {
          path: pathOutput,
          success: false,
          error: 'Path exists but is not a directory',
          resolvedPath: targetPath,
        };
  } catch (statError: unknown) {
    // Error logged via McpError
    return {
      path: pathOutput,
      success: false,
      error: `Failed to stat existing path: ${statError instanceof Error ? statError.message : String(statError)}`,
      resolvedPath: targetPath,
    };
  }
}

/** Handles general errors during directory creation. */
function handleDirectoryCreationError(
  error: unknown,
  pathOutput: string,
  targetPath: string,
  // No deps needed here as it only formats errors
): CreateDirResult {
  // Handle McpError specifically (likely from resolvePath)
  if (error instanceof McpError) {
    return {
      path: pathOutput,
      success: false,
      error: error.message, // Use the McpError message directly
      resolvedPath: targetPath || 'Resolution failed', // targetPath might be empty if resolvePath failed early
    };
  }

  // Handle filesystem errors (like EPERM, EACCES, etc.)
  const errorMessage = error instanceof Error ? error.message : String(error);
  let specificError = `Failed to create directory: ${errorMessage}`;

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'EPERM' || error.code === 'EACCES')
  ) {
    specificError = `Permission denied creating directory: ${errorMessage}`;
  }
  // Note: EEXIST is handled separately by handleEexistError

  // Error logged via McpError
  return {
    path: pathOutput,
    success: false,
    error: specificError,
    resolvedPath: targetPath || 'Resolution failed',
  };
}

/** Processes the creation of a single directory. */
async function processSingleDirectoryCreation(
  relativePath: string, // Corrected signature: relativePath first
  deps: CreateDirsDeps, // Corrected signature: deps second
): Promise<CreateDirResult> {
  const pathOutput = relativePath.replaceAll('\\', '/'); // Normalize for output consistency
  let targetPath = '';
  try {
    targetPath = deps.resolvePath(relativePath); // Use deps.resolvePath
    if (targetPath === deps.PROJECT_ROOT) {
      // Use deps.PROJECT_ROOT
      return {
        path: pathOutput,
        success: false,
        error: 'Creating the project root is not allowed.',
        resolvedPath: targetPath,
      };
    }
    await deps.mkdir(targetPath, { recursive: true }); // Use deps.mkdir
    return { path: pathOutput, success: true, resolvedPath: targetPath };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      // Pass deps to handleEexistError
      return await handleEexistError(targetPath, pathOutput, deps);
    }
    // Pass potential McpError from resolvePath or other errors
    return handleDirectoryCreationError(error, pathOutput, targetPath);
  }
}

/** Processes results from Promise.allSettled. */
export function processSettledResults( // Keep export for testing
  results: PromiseSettledResult<CreateDirResult>[],
  originalPaths: string[],
): CreateDirResult[] {
  return results.map((result, index) => {
    const originalPath = originalPaths[index] ?? 'unknown_path';
    const pathOutput = originalPath.replaceAll('\\', '/');

    return result.status === 'fulfilled'
      ? result.value
      : {
          path: pathOutput,
          success: false,
          error: `Unexpected error during processing: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          resolvedPath: 'Unknown on rejection',
        };
  });
}

/** Main handler function (internal, accepts dependencies) */
// Export for testing
export const handleCreateDirectoriesInternal = async (
  args: unknown,
  deps: CreateDirsDeps,
): Promise<McpToolResponse> => {
  let pathsToCreate: string[];
  try {
    // Validate arguments first
    const validatedArgs = parseAndValidateArgs(args);
    pathsToCreate = validatedArgs.paths;
  } catch (error) {
    // If validation fails, re-throw the McpError from parseAndValidateArgs
    if (error instanceof McpError) {
      throw error;
    }
    // Wrap unexpected validation errors
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unexpected error during argument validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Proceed with validated paths
  const creationPromises = pathsToCreate.map((p) => processSingleDirectoryCreation(p, deps));
  const settledResults = await Promise.allSettled(creationPromises);

  const outputResults = processSettledResults(settledResults, pathsToCreate);

  // Sort results by original path order for predictability
  const originalIndexMap = new Map(pathsToCreate.map((p, i) => [p.replaceAll('\\', '/'), i]));
  outputResults.sort((a, b) => {
    const indexA = originalIndexMap.get(a.path) ?? Infinity;
    const indexB = originalIndexMap.get(b.path) ?? Infinity;
    return indexA - indexB;
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(outputResults, undefined, 2) }],
  };
};

// Export the complete tool definition using the production handler
export const createDirectoriesToolDefinition = {
  name: 'create_directories',
  description: 'Create multiple specified directories (including intermediate ones).',
  inputSchema: CreateDirsArgsSchema,
  handler: (args: unknown): Promise<McpToolResponse> => {
    // Production handler provides real dependencies
    const productionDeps: CreateDirsDeps = {
      mkdir: fs.mkdir,
      stat: fs.stat,
      resolvePath: resolvePath,
      PROJECT_ROOT: PROJECT_ROOT,
    };
    return handleCreateDirectoriesInternal(args, productionDeps);
  },
};
