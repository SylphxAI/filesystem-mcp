// src/handlers/chmodItems.ts
import { promises as fs } from 'fs';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

export const ChmodItemsArgsSchema = z
  .object({
    paths: z
      .array(z.string())
      .min(1, { message: 'Paths array cannot be empty' })
      .describe('An array of relative paths.'),
    mode: z
      .string()
      .regex(/^[0-7]{3,4}$/, {
        message: "Mode must be an octal string like '755' or '0755'",
      })
      .describe("The permission mode as an octal string (e.g., '755', '644')."),
  })
  .strict();

type ChmodItemsArgs = z.infer<typeof ChmodItemsArgsSchema>;

interface ChmodResult {
  path: string;
  success: boolean;
  mode?: string; // Include mode on success
  error?: string;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): ChmodItemsArgs {
  try {
    return ChmodItemsArgsSchema.parse(args);
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

/** Handles errors during chmod operation. */
function handleChmodError(
  error: unknown,
  relativePath: string,
  pathOutput: string,
): ChmodResult {
  let errorMessage = `Failed to change mode: ${error instanceof Error ? error.message : String(error)}`;
  let logError = true;

  if (error instanceof McpError) {
    errorMessage = error.message;
    logError = false;
  } else if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'ENOENT') {
      errorMessage = 'Path not found';
      logError = false; // ENOENT is a common, expected error
    } else if (error.code === 'EPERM' || error.code === 'EACCES') {
      errorMessage = `Permission denied changing mode for ${relativePath}`;
    }
  }

  if (logError) {
    console.error(
      `[Filesystem MCP - chmodItems] Error changing mode for ${relativePath}:`,
      error,
    );
  }

  return { path: pathOutput, success: false, error: errorMessage };
}

/** Processes the chmod operation for a single path. */
async function processSingleChmodOperation(
  relativePath: string,
  mode: number, // Pass parsed mode
  modeString: string, // Pass original string for success result
): Promise<ChmodResult> {
  const pathOutput = relativePath.replace(/\\/g, '/');
  try {
    const targetPath = resolvePath(relativePath);
    if (targetPath === PROJECT_ROOT) {
      return {
        path: pathOutput,
        success: false,
        error: 'Changing permissions of the project root is not allowed.',
      };
    }
    await fs.chmod(targetPath, mode);
    return { path: pathOutput, success: true, mode: modeString };
  } catch (error: unknown) {
    return handleChmodError(error, relativePath, pathOutput);
  }
}

/** Processes results from Promise.allSettled. */
function processSettledResults(
  results: PromiseSettledResult<ChmodResult>[],
  originalPaths: string[],
): ChmodResult[] {
  return results.map((result, index) => {
    const originalPath = originalPaths[index] ?? 'unknown_path';
    const pathOutput = originalPath.replace(/\\/g, '/');

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - chmodItems] Unexpected rejection for path ${originalPath}:`,
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
const handleChmodItemsFunc = async (
  args: unknown,
): Promise<McpToolResponse> => {
  const { paths: relativePaths, mode: modeString } = parseAndValidateArgs(args);
  const mode = parseInt(modeString, 8); // Parse mode once

  const chmodPromises = relativePaths.map((relativePath) =>
    processSingleChmodOperation(relativePath, mode, modeString),
  );
  const settledResults = await Promise.allSettled(chmodPromises);

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
export const chmodItemsToolDefinition = {
  name: 'chmod_items',
  description:
    'Change permissions mode for multiple specified files/directories (POSIX-style).',
  schema: ChmodItemsArgsSchema,
  handler: handleChmodItemsFunc,
};
