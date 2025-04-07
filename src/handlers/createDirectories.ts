// src/handlers/createDirectories.ts
import { promises as fs, type Stats } from 'fs'; // Import Stats type
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

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
  error?: string;
  resolvedPath?: string;
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
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
}

/** Handles EEXIST errors by checking if the existing path is a directory. */
async function handleEexistError(
  targetPath: string,
  pathOutput: string,
): Promise<CreateDirResult> {
  try {
    const stats: Stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      return {
        path: pathOutput,
        success: true,
        note: 'Directory already exists',
        resolvedPath: targetPath,
      };
    } else {
      return {
        path: pathOutput,
        success: false,
        error: 'Path exists but is not a directory',
        resolvedPath: targetPath,
      };
    }
  } catch (statError: unknown) {
    console.error(
      `[Filesystem MCP - createDirs] Error stating existing path ${targetPath}:`,
      statError,
    );
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
): CreateDirResult {
  if (error instanceof McpError) {
    // Re-throw McpErrors related to path resolution if needed,
    // otherwise format them for the result.
    return {
      path: pathOutput,
      success: false,
      error: error.message, // Or a more specific message
      resolvedPath: targetPath || 'Resolution failed',
    };
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  let specificError = `Failed to create directory: ${errorMessage}`;
  let logMessage = `[Filesystem MCP - createDirs] Error creating directory ${targetPath}:`;

  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      specificError = `Permission denied creating directory: ${errorMessage}`;
      logMessage = `[Filesystem MCP - createDirs] Permission error creating directory ${targetPath}:`;
    }
    // Note: EEXIST is handled by handleEexistError
  }

  console.error(logMessage, error);
  return {
    path: pathOutput,
    success: false,
    error: specificError,
    resolvedPath: targetPath || 'Resolution failed',
  };
}

/** Processes the creation of a single directory. */
async function processSingleDirectoryCreation( // Remove export
  relativePath: string,
): Promise<CreateDirResult> {
  const pathOutput = relativePath.replace(/\\/g, '/');
  let targetPath = '';
  try {
    targetPath = resolvePath(relativePath);
    if (targetPath === PROJECT_ROOT) {
      return {
        path: pathOutput,
        success: false,
        error: 'Creating the project root is not allowed.',
        resolvedPath: targetPath,
      };
    }
    // console.log(`Attempting mkdir: ${targetPath}`); // Debug log
    await fs.mkdir(targetPath, { recursive: true });
    // console.log(`Success mkdir: ${targetPath}`); // Debug log
    return { path: pathOutput, success: true, resolvedPath: targetPath };
  } catch (error: unknown) {
    // console.error(`Error mkdir ${targetPath}:`, error); // Debug log
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      return await handleEexistError(targetPath, pathOutput);
    }
    return handleDirectoryCreationError(error, pathOutput, targetPath);
  }
}

/** Processes results from Promise.allSettled. */
export function processSettledResults( // Add export for testing
  results: PromiseSettledResult<CreateDirResult>[],
  originalPaths: string[],
): CreateDirResult[] {
  return results.map((result, index) => {
    const originalPath = originalPaths[index] ?? 'unknown_path'; // Fallback
    const pathOutput = originalPath.replace(/\\/g, '/');

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      // Handle unexpected rejections (errors not caught in processSingleDirectoryCreation)
      console.error(
        `[Filesystem MCP - createDirs] Unexpected rejection for path ${originalPath}:`,
        result.reason,
      );
      return {
        path: pathOutput,
        success: false,
        error: `Unexpected error during processing: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        resolvedPath: 'Unknown on rejection',
      };
    }
  });
}

/** Main handler function */
const handleCreateDirectoriesFunc = async (
  args: unknown,
): Promise<McpToolResponse> => {
  const { paths: pathsToCreate } = parseAndValidateArgs(args);

  const creationPromises = pathsToCreate.map(processSingleDirectoryCreation);
  const settledResults = await Promise.allSettled(creationPromises);

  const outputResults = processSettledResults(settledResults, pathsToCreate);

  // Sort results by original path order for predictability
  // Create a map for quick lookup of original index
  const originalIndexMap = new Map(
    pathsToCreate.map((p, i) => [p.replace(/\\/g, '/'), i]),
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
export const createDirectoriesToolDefinition = {
  name: 'create_directories',
  description:
    'Create multiple specified directories (including intermediate ones).',
  schema: CreateDirsArgsSchema,
  handler: handleCreateDirectoriesFunc,
};
