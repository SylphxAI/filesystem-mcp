// src/handlers/moveItems.ts
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

export const MoveOperationSchema = z
  .object({
    source: z.string().describe('Relative path of the source.'),
    destination: z.string().describe('Relative path of the destination.'),
  })
  .strict();

export const MoveItemsArgsSchema = z
  .object({
    operations: z
      .array(MoveOperationSchema)
      .min(1, { message: 'Operations array cannot be empty' })
      .describe('Array of {source, destination} objects.'),
  })
  .strict();

type MoveItemsArgs = z.infer<typeof MoveItemsArgsSchema>;
type MoveOperation = z.infer<typeof MoveOperationSchema>;

interface MoveResult {
  source: string;
  destination: string;
  success: boolean;
  error?: string;
}

// --- Parameter Interfaces ---

interface HandleMoveErrorParams {
  error: unknown;
  sourceRelative: string;
  destinationRelative: string;
  sourceOutput: string;
  destOutput: string;
}

interface ProcessSingleMoveParams {
  op: MoveOperation;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): MoveItemsArgs {
  try {
    return MoveItemsArgsSchema.parse(args);
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

/** Handles errors during the move operation for a single item. */
function handleMoveError({
  error,
  sourceRelative,
  destinationRelative,
  sourceOutput,
  destOutput,
}: HandleMoveErrorParams): MoveResult {
  let errorMessage = 'An unknown error occurred during move/rename.';
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
    errorMessage = error.message; // Preserve specific MCP errors (e.g., path resolution)
  } else if (error instanceof Error) {
    errorMessage = `Failed to move item: ${error.message}`;
  }

  // Handle specific filesystem error codes
  if (errorCode === 'ENOENT') {
    errorMessage = `Source path not found: ${sourceRelative}`;
  } else if (errorCode === 'EPERM' || errorCode === 'EACCES') {
    errorMessage = `Permission denied moving '${sourceRelative}' to '${destinationRelative}'.`;
  }
  // TODO: Consider handling EXDEV (cross-device link)

  console.error(
    `[Filesystem MCP - moveItems] Error moving item from ${sourceRelative} to ${destinationRelative}:`,
    error,
  );

  return {
    source: sourceOutput,
    destination: destOutput,
    success: false,
    error: errorMessage,
  };
}

/** Processes a single move/rename operation. */
async function processSingleMoveOperation(
  params: ProcessSingleMoveParams,
): Promise<MoveResult> {
  const { op } = params;
  const sourceRelative = op.source;
  const destinationRelative = op.destination;
  const sourceOutput = sourceRelative.replace(/\\/g, '/');
  const destOutput = destinationRelative.replace(/\\/g, '/');

  try {
    const sourceAbsolute = resolvePath(sourceRelative);
    const destinationAbsolute = resolvePath(destinationRelative);

    if (sourceAbsolute === PROJECT_ROOT) {
      return {
        source: sourceOutput,
        destination: destOutput,
        success: false,
        error: 'Moving the project root is not allowed.',
      };
    }
    // Security Note: resolvePath already prevents destinationAbsolute from being outside PROJECT_ROOT

    // Ensure parent directory of destination exists before moving
    const destDir = path.dirname(destinationAbsolute);
    // Avoid creating the root dir itself if dest is in root
    if (destDir !== PROJECT_ROOT) {
      await fs.mkdir(destDir, { recursive: true });
    }

    // Now attempt the move/rename
    await fs.rename(sourceAbsolute, destinationAbsolute);
    return { source: sourceOutput, destination: destOutput, success: true };
  } catch (error: unknown) {
    return handleMoveError({
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
  results: PromiseSettledResult<MoveResult>[],
  originalOps: MoveOperation[],
): MoveResult[] {
  return results.map((result, index) => {
    const op = originalOps[index];
    const sourceOutput = (op?.source ?? 'unknown').replace(/\\/g, '/');
    const destOutput = (op?.destination ?? 'unknown').replace(/\\/g, '/');

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - moveItems] Unexpected rejection for operation ${JSON.stringify(op)}:`,
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
const handleMoveItemsFunc = async (args: unknown): Promise<McpToolResponse> => {
  const { operations } = parseAndValidateArgs(args);

  const movePromises = operations.map((op) =>
    processSingleMoveOperation({ op }),
  );
  const settledResults = await Promise.allSettled(movePromises);

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
export const moveItemsToolDefinition = {
  name: 'move_items',
  description: 'Move or rename multiple specified files/directories.',
  schema: MoveItemsArgsSchema,
  handler: handleMoveItemsFunc,
};
