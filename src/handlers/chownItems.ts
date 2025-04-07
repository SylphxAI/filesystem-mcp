// src/handlers/chownItems.ts
import { promises as fs } from 'fs';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

export const ChownItemsArgsSchema = z
  .object({
    paths: z
      .array(z.string())
      .min(1, { message: 'Paths array cannot be empty' })
      .describe('An array of relative paths.'),
    uid: z
      .number()
      .int({ message: 'UID must be an integer' })
      .describe('User ID.'),
    gid: z
      .number()
      .int({ message: 'GID must be an integer' })
      .describe('Group ID.'),
  })
  .strict();

type ChownItemsArgs = z.infer<typeof ChownItemsArgsSchema>;

interface ChownResult {
  path: string;
  success: boolean;
  uid?: number;
  gid?: number;
  error?: string;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): ChownItemsArgs {
  try {
    return ChownItemsArgsSchema.parse(args);
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

/** Handles errors during chown operation. */
function handleChownError(
  error: unknown,
  relativePath: string,
  pathOutput: string,
): ChownResult {
  let errorMessage = `Failed to change ownership: ${error instanceof Error ? error.message : String(error)}`;
  let logError = true;

  if (error instanceof McpError) {
    errorMessage = error.message;
    logError = false;
  } else if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'ENOENT') {
      errorMessage = 'Path not found';
      logError = false;
    } else if (error.code === 'EPERM') {
      // Common error on Windows or insufficient permissions
      errorMessage =
        'Operation not permitted (Permissions or unsupported on OS)';
    }
  }

  if (logError) {
    console.error(
      `[Filesystem MCP - chownItems] Error changing ownership for ${relativePath}:`,
      error,
    );
  }

  return { path: pathOutput, success: false, error: errorMessage };
}

/** Processes the chown operation for a single path. */
async function processSingleChownOperation(
  relativePath: string,
  uid: number,
  gid: number,
): Promise<ChownResult> {
  const pathOutput = relativePath.replace(/\\/g, '/');
  try {
    const targetPath = resolvePath(relativePath);
    if (targetPath === PROJECT_ROOT) {
      return {
        path: pathOutput,
        success: false,
        error: 'Changing ownership of the project root is not allowed.',
      };
    }
    await fs.chown(targetPath, uid, gid);
    return { path: pathOutput, success: true, uid, gid };
  } catch (error: unknown) {
    return handleChownError(error, relativePath, pathOutput);
  }
}

/** Processes results from Promise.allSettled. */
function processSettledResults(
  results: PromiseSettledResult<ChownResult>[],
  originalPaths: string[],
): ChownResult[] {
  return results.map((result, index) => {
    const originalPath = originalPaths[index] ?? 'unknown_path';
    const pathOutput = originalPath.replace(/\\/g, '/');

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - chownItems] Unexpected rejection for path ${originalPath}:`,
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
const handleChownItemsFunc = async (
  args: unknown,
): Promise<McpToolResponse> => {
  const { paths: relativePaths, uid, gid } = parseAndValidateArgs(args);

  const chownPromises = relativePaths.map((relativePath) =>
    processSingleChownOperation(relativePath, uid, gid),
  );
  const settledResults = await Promise.allSettled(chownPromises);

  const outputResults = processSettledResults(settledResults, relativePaths);

  // Sort results by original path order for predictability
  const originalIndexMap = new Map(
    relativePaths.map((p, i) => [p.replace(/\\/g, '/'), i]),
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
export const chownItemsToolDefinition = {
  name: 'chown_items',
  description:
    'Change owner (UID) and group (GID) for multiple specified files/directories.',
  schema: ChownItemsArgsSchema,
  handler: handleChownItemsFunc,
};
