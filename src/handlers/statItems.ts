// src/handlers/statItems.ts
import { promises as fs, type Stats } from 'fs'; // Import Stats
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath } from '../utils/pathUtils.js';
import type { FormattedStats } from '../utils/statsUtils.js'; // Import type
import { formatStats } from '../utils/statsUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

export const StatItemsArgsSchema = z
  .object({
    paths: z
      .array(z.string())
      .min(1, { message: 'Paths array cannot be empty' })
      .describe(
        'An array of relative paths (files or directories) to get status for.',
      ),
  })
  .strict();

type StatItemsArgs = z.infer<typeof StatItemsArgsSchema>;

interface StatResult {
  path: string;
  status: 'success' | 'error';
  stats?: FormattedStats;
  error?: string;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): StatItemsArgs {
  try {
    return StatItemsArgsSchema.parse(args);
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

/** Handles errors during stat operation. */
function handleStatError(
  error: unknown,
  relativePath: string,
  pathOutput: string,
): StatResult {
  let errorMessage = `Failed to get stats: ${error instanceof Error ? error.message : String(error)}`;
  let logError = true;

  if (error instanceof McpError) {
    errorMessage = error.message; // Use McpError message directly
    logError = false; // Assume McpError was logged at source or is expected
  } else if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'ENOENT') {
      errorMessage = 'Path not found';
      logError = false; // ENOENT is a common, expected error
    } else if (error.code === 'EACCES' || error.code === 'EPERM') {
      errorMessage = `Permission denied stating path: ${relativePath}`;
    }
  }

  if (logError) {
    console.error(
      `[Filesystem MCP - statItems] Error stating item ${relativePath}:`,
      error,
    );
  }

  return {
    path: pathOutput,
    status: 'error',
    error: errorMessage,
  };
}

/** Processes the stat operation for a single path. */
async function processSingleStatOperation(
  relativePath: string,
): Promise<StatResult> {
  const pathOutput = relativePath.replace(/\\/g, '/');
  try {
    const targetPath = resolvePath(relativePath);
    const stats: Stats = await fs.stat(targetPath); // Explicitly type Stats
    return {
      path: pathOutput,
      status: 'success',
      stats: formatStats(relativePath, targetPath, stats), // Pass targetPath as absolutePath
    };
  } catch (error: unknown) {
    return handleStatError(error, relativePath, pathOutput);
  }
}

/** Processes results from Promise.allSettled. */
function processSettledResults(
  results: PromiseSettledResult<StatResult>[],
  originalPaths: string[],
): StatResult[] {
  return results.map((result, index) => {
    const originalPath = originalPaths[index] ?? 'unknown_path';
    const pathOutput = originalPath.replace(/\\/g, '/');

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      // Handle unexpected rejections
      console.error(
        `[Filesystem MCP - statItems] Unexpected rejection for path ${originalPath}:`,
        result.reason,
      );
      return {
        path: pathOutput,
        status: 'error',
        error: `Unexpected error during processing: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      };
    }
  });
}

/** Main handler function */
const handleStatItemsFunc = async (args: unknown): Promise<McpToolResponse> => {
  const { paths: pathsToStat } = parseAndValidateArgs(args);

  const statPromises = pathsToStat.map(processSingleStatOperation);
  const settledResults = await Promise.allSettled(statPromises);

  const outputResults = processSettledResults(settledResults, pathsToStat);

  // Sort results by original path order for predictability
  const originalIndexMap = new Map(
    pathsToStat.map((p, i) => [p.replace(/\\/g, '/'), i]),
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
export const statItemsToolDefinition = {
  name: 'stat_items',
  description: 'Get detailed status information for multiple specified paths.',
  schema: StatItemsArgsSchema,
  handler: handleStatItemsFunc,
};
