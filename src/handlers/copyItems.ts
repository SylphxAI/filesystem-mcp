// src/handlers/copyItems.ts
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

export const CopyOperationSchema = z
  .object({
    source: z.string().describe('Relative path of the source.'),
    destination: z.string().describe('Relative path of the destination.'),
  })
  .strict();

export const CopyItemsArgsSchema = z
  .object({
    operations: z
      .array(CopyOperationSchema)
      .min(1, { message: 'Operations array cannot be empty' })
      .describe('Array of {source, destination} objects.'),
  })
  .strict();

type CopyItemsArgs = z.infer<typeof CopyItemsArgsSchema>;
type CopyOperation = z.infer<typeof CopyOperationSchema>; // Export or define locally if needed

interface CopyResult {
  source: string;
  destination: string;
  success: boolean;
  error?: string;
}

// --- Parameter Interfaces ---

interface HandleCopyErrorParams {
  error: unknown;
  sourceRelative: string;
  destinationRelative: string;
  sourceOutput: string;
  destOutput: string;
}

interface ProcessSingleCopyParams {
  op: CopyOperation;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): CopyItemsArgs {
  try {
    return CopyItemsArgsSchema.parse(args);
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

/** Handles errors during the copy operation for a single item. */
function handleCopyError(params: HandleCopyErrorParams): CopyResult {
  const {
    error,
    sourceRelative,
    destinationRelative,
    sourceOutput,
    destOutput,
  } = params;

  let errorMessage = 'An unknown error occurred during copy.';
  let errorCode: string | null = null;

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    errorCode = error.code;
  }

  if (error instanceof McpError) {
    errorMessage = error.message;
  } else if (error instanceof Error) {
    errorMessage = `Failed to copy item: ${error.message}`;
  }

  if (errorCode === 'ENOENT') {
    errorMessage = `Source path not found: ${sourceRelative}`;
  } else if (errorCode === 'EPERM' || errorCode === 'EACCES') {
    errorMessage = `Permission denied copying '${sourceRelative}' to '${destinationRelative}'.`;
  }

  console.error(
    `[Filesystem MCP - copyItems] Error copying item from ${sourceRelative} to ${destinationRelative}:`,
    error, // Log original error
  );

  return {
    source: sourceOutput,
    destination: destOutput,
    success: false,
    error: errorMessage,
  };
}

/** Processes a single copy operation. */
async function processSingleCopyOperation(
  params: ProcessSingleCopyParams,
): Promise<CopyResult> {
  const { op } = params;
  const sourceRelative = op.source;
  const destinationRelative = op.destination;
  const sourceOutput = sourceRelative.replace(/\\/g, '/');
  const destOutput = destinationRelative.replace(/\\/g, '/');
  let sourceAbsolute = ''; // Initialize for potential use in error message

  try {
    sourceAbsolute = resolvePath(sourceRelative);
    const destinationAbsolute = resolvePath(destinationRelative);

    if (sourceAbsolute === PROJECT_ROOT) {
      return {
        source: sourceOutput,
        destination: destOutput,
        success: false,
        error: 'Copying the project root is not allowed.',
      };
    }

    // Ensure parent directory of destination exists
    const destDir = path.dirname(destinationAbsolute);
    await fs.mkdir(destDir, { recursive: true });

    // Perform the copy (recursive for directories)
    await fs.cp(sourceAbsolute, destinationAbsolute, {
      recursive: true,
      errorOnExist: false, // Overwrite existing files/dirs
      force: true, // Ensure overwrite
    });

    return { source: sourceOutput, destination: destOutput, success: true };
  } catch (error: unknown) {
    return handleCopyError({
      // Pass object
      error,
      sourceRelative,
      destinationRelative,
      sourceOutput,
      destOutput,
    });
  }
}

/** Processes results from Promise.allSettled. */
function processSettledResults(
  results: PromiseSettledResult<CopyResult>[],
  originalOps: CopyOperation[],
): CopyResult[] {
  return results.map((result, index) => {
    const op = originalOps[index];
    const sourceOutput = (op?.source ?? 'unknown').replace(/\\/g, '/');
    const destOutput = (op?.destination ?? 'unknown').replace(/\\/g, '/');

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - copyItems] Unexpected rejection for operation ${JSON.stringify(op)}:`,
        result.reason,
      );
      return {
        source: sourceOutput,
        destination: destOutput,
        success: false,
        error: `Unexpected error during processing: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      };
    }
  });
}

/** Main handler function */
const handleCopyItemsFunc = async (args: unknown): Promise<McpToolResponse> => {
  const { operations } = parseAndValidateArgs(args);

  const copyPromises = operations.map((op) =>
    processSingleCopyOperation({ op }),
  );
  const settledResults = await Promise.allSettled(copyPromises);

  const outputResults = processSettledResults(settledResults, operations);

  // Sort results based on the original order
  const originalIndexMap = new Map(
    operations.map((op, i) => [op.source.replace(/\\/g, '/'), i]),
  );
  outputResults.sort((a, b) => {
    const indexA = originalIndexMap.get(a.source) ?? Infinity;
    const indexB = originalIndexMap.get(b.source) ?? Infinity;
    return indexA - indexB;
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(outputResults, null, 2) }],
  };
};

// Export the complete tool definition
export const copyItemsToolDefinition = {
  name: 'copy_items',
  description: 'Copy multiple specified files/directories.',
  schema: CopyItemsArgsSchema,
  handler: handleCopyItemsFunc,
};
