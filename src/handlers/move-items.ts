// src/handlers/moveItems.ts
import fsPromises from 'node:fs/promises'; // Use default import
import path from 'node:path';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import * as pathUtils from '../utils/path-utils.js'; // Import namespace

// --- Dependency Injection Interface ---
interface MoveItemsDependencies {
  access: typeof fsPromises.access;
  rename: typeof fsPromises.rename;
  mkdir: typeof fsPromises.mkdir;
  resolvePath: typeof pathUtils.resolvePath;
  PROJECT_ROOT: string;
}
// --- Types ---
import type { McpToolResponse } from '../types/mcp-types.js';

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
  let errorCode: string | undefined = undefined;

  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
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

  // Error logged via McpError

  return {
    source: sourceOutput,
    destination: destOutput,
    success: false,
    error: errorMessage,
  };
}

interface SourceCheckParams {
  sourceAbsolute: string;
  sourceRelative: string;
  sourceOutput: string;
  destOutput: string;
}

interface MoveOperationParams {
  sourceAbsolute: string;
  destinationAbsolute: string;
  sourceOutput: string;
  destOutput: string;
}

/** Validates move operation parameters. */
function validateMoveOperation(op: MoveOperation | undefined): MoveResult | undefined {
  if (!op || !op.source || !op.destination) {
    const sourceOutput = op?.source?.replaceAll('\\', '/') || 'undefined';
    const destOutput = op?.destination?.replaceAll('\\', '/') || 'undefined';
    return {
      source: sourceOutput,
      destination: destOutput,
      success: false,
      error: 'Invalid operation: source and destination must be defined.',
    };
  }
  return undefined;
}

/** Handles special error cases for move operations. */
function handleSpecialMoveErrors(
  error: unknown,
  sourceOutput: string,
  destOutput: string,
): MoveResult | undefined {
  if (error instanceof McpError && error.message.includes('Absolute paths are not allowed')) {
    return {
      source: sourceOutput,
      destination: destOutput,
      success: false,
      error: error.message,
    };
  }
  return undefined;
}

/** Processes a single move/rename operation. */
async function processSingleMoveOperation(
  params: ProcessSingleMoveParams,
  dependencies: MoveItemsDependencies, // Inject dependencies
): Promise<MoveResult> {
  const { op } = params;

  // Validate operation parameters
  const validationResult = validateMoveOperation(op);
  if (validationResult) return validationResult;

  const sourceRelative = op.source;
  const destinationRelative = op.destination;
  const sourceOutput = sourceRelative.replaceAll('\\', '/');
  const destOutput = destinationRelative.replaceAll('\\', '/');

  try {
    // Safely resolve paths using injected dependency
    const sourceAbsolute = dependencies.resolvePath(sourceRelative);
    const destinationAbsolute = dependencies.resolvePath(destinationRelative);

    if (sourceAbsolute === dependencies.PROJECT_ROOT) { // Use injected dependency
      return {
        source: sourceOutput,
        destination: destOutput,
        success: false,
        error: 'Moving the project root is not allowed.',
      };
    }

    // Check source existence using injected dependency
    const sourceCheckResult = await checkSourceExists(
      {
        sourceAbsolute,
        sourceRelative,
        sourceOutput,
        destOutput,
      },
      dependencies, // Pass dependencies
    );
    // Ensure we return immediately if source check fails (No change needed here, already correct)
    if (sourceCheckResult) return sourceCheckResult;
    // Perform the move using injected dependency
    return await performMoveOperation(
      {
        sourceAbsolute,
        destinationAbsolute,
        sourceOutput,
        destOutput,
      },
      dependencies, // Pass dependencies
    );
  } catch (error) {
    const specialErrorResult = handleSpecialMoveErrors(error, sourceOutput, destOutput);
    if (specialErrorResult) return specialErrorResult;

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
    const sourceOutput = (op?.source ?? 'unknown').replaceAll('\\', '/');
    const destOutput = (op?.destination ?? 'unknown').replaceAll('\\', '/');

    return result.status === 'fulfilled'
      ? result.value
      : {
          source: sourceOutput,
          destination: destOutput,
          success: false,
          error: `Unexpected error during processing: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        };
  });
}

/** Core logic function with dependency injection */
export const handleMoveItemsFuncCore = async (
  args: unknown,
  dependencies: MoveItemsDependencies,
): Promise<McpToolResponse> => {
  const { operations } = parseAndValidateArgs(args);

  const movePromises = operations.map((op) =>
    processSingleMoveOperation({ op }, dependencies), // Pass dependencies
  );
  const settledResults = await Promise.allSettled(movePromises);

  const outputResults = processSettledResults(settledResults, operations);

  // Sort results based on the original order
  const originalIndexMap = new Map(operations.map((op, i) => [op.source.replaceAll('\\', '/'), i]));
  outputResults.sort((a, b) => {
    const indexA = originalIndexMap.get(a.source) ?? Infinity;
    const indexB = originalIndexMap.get(b.source) ?? Infinity;
    return indexA - indexB;
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(outputResults, undefined, 2) }],
  };
};

// --- Exported Handler (Wrapper) ---

/** Main handler function (wraps core logic with actual dependencies) */
const handleMoveItemsFunc = async (args: unknown): Promise<McpToolResponse> => {
  const dependencies: MoveItemsDependencies = {
    access: fsPromises.access,
    rename: fsPromises.rename,
    mkdir: fsPromises.mkdir,
    resolvePath: pathUtils.resolvePath,
    PROJECT_ROOT: pathUtils.PROJECT_ROOT,
  };
  return handleMoveItemsFuncCore(args, dependencies);
};

// Export the complete tool definition using the wrapper handler
export const moveItemsToolDefinition = {
  name: 'move_items',
  description: 'Move or rename multiple specified files/directories.',
  inputSchema: MoveItemsArgsSchema,
  handler: handleMoveItemsFunc, // Use the wrapper
};

// --- Helper Functions Modified for DI ---

/** Checks if source exists and is accessible. */
async function checkSourceExists(
  params: SourceCheckParams,
  dependencies: MoveItemsDependencies, // Inject dependencies
): Promise<MoveResult | undefined> {
  try {
    await dependencies.access(params.sourceAbsolute); // Use injected dependency
    return undefined;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {
        source: params.sourceOutput,
        destination: params.destOutput,
        success: false,
        error: `Source path not found: ${params.sourceRelative}`,
      };
    }
    // Log other access errors for debugging, but rethrow to be caught by main handler
    console.error(`[Filesystem MCP - checkSourceExists] Unexpected access error for ${params.sourceRelative}:`, error);
    throw error;
  }
}

/** Performs the actual move operation. */
async function performMoveOperation(
  params: MoveOperationParams,
  dependencies: MoveItemsDependencies, // Inject dependencies
): Promise<MoveResult> {
  const destDir = path.dirname(params.destinationAbsolute);
  
  // Skip mkdir if:
  // 1. Destination is in root (destDir === PROJECT_ROOT)
  // 2. Or if destination is the same directory as source (no new dir needed)
  const sourceDir = path.dirname(params.sourceAbsolute);
  const needsMkdir = destDir !== dependencies.PROJECT_ROOT && destDir !== sourceDir;
  
  if (needsMkdir) {
      try {
          await dependencies.mkdir(destDir, { recursive: true });
      } catch (mkdirError: unknown) {
          // If mkdir fails for reasons other than EEXIST, it's a critical problem for rename
          if (!(mkdirError && typeof mkdirError === 'object' && 'code' in mkdirError && mkdirError.code === 'EEXIST')) {
              console.error(`[Filesystem MCP - performMoveOperation] Critical error creating destination directory ${destDir}:`, mkdirError);
              // Return the mkdir error directly
              return handleMoveError({
                  error: mkdirError,
                  sourceRelative: params.sourceOutput, // Pass relative path for better error message
                  destinationRelative: params.destOutput, // Pass relative path for better error message
                  sourceOutput: params.sourceOutput,
                  destOutput: params.destOutput,
              });
          }
          // Ignore EEXIST - directory already exists
      }
  }
  
  await dependencies.rename(params.sourceAbsolute, params.destinationAbsolute); // Use injected dependency
  return {
    source: params.sourceOutput,
    destination: params.destOutput,
    success: true,
  };
}
