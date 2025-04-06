import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// Define the expected MCP response structure locally
interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

/**
 * Handles the 'move_items' MCP tool request.
 * Moves or renames multiple specified files/directories.
 */
// Removed extra comment marker

// Define Zod schema for individual operations and export it
export const MoveOperationSchema = z
  .object({
    source: z.string().describe('Relative path of the source.'),
    destination: z.string().describe('Relative path of the destination.'),
  })
  .strict();

// Define Zod schema for the main arguments object and export it
export const MoveItemsArgsSchema = z
  .object({
    operations: z
      .array(MoveOperationSchema)
      .min(1, { message: 'Operations array cannot be empty' })
      .describe('Array of {source, destination} objects.'),
  })
  .strict();

// Infer TypeScript type
type MoveItemsArgs = z.infer<typeof MoveItemsArgsSchema>;
// Removed duplicated non-exported schema/type definitions comment

const handleMoveItemsFunc = async (args: unknown): Promise<McpToolResponse> => {
  // Use local type
  // Validate and parse arguments
  let parsedArgs: MoveItemsArgs;
  try {
    parsedArgs = MoveItemsArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
  const { operations } = parsedArgs;

  // Define result structure
  interface MoveResult {
    source: string;
    destination: string;
    success: boolean;
    error?: string;
  }

  const results = await Promise.allSettled(
    operations.map(async (op): Promise<MoveResult> => {
      const sourceRelative = op.source;
      const destinationRelative = op.destination;
      const sourceOutput = sourceRelative.replace(/\\/g, '/'); // Ensure consistent path separators early
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
        await fs.mkdir(destDir, { recursive: true });

        // Now attempt the move/rename
        await fs.rename(sourceAbsolute, destinationAbsolute);
        return { source: sourceOutput, destination: destOutput, success: true };
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return {
            source: sourceOutput,
            destination: destOutput,
            success: false,
            error: `Source path not found: ${sourceRelative}`,
          };
        }
        if (error.code === 'EPERM' || error.code === 'EACCES') {
          return {
            source: sourceOutput,
            destination: destOutput,
            success: false,
            error: `Permission denied moving '${sourceRelative}' to '${destinationRelative}'.`,
          };
        }
        // TODO: Consider handling EXDEV (cross-device link) by copying and deleting if needed
        if (error instanceof McpError) {
          return {
            source: sourceOutput,
            destination: destOutput,
            success: false,
            error: error.message,
          };
        }
        console.error(
          `[Filesystem MCP - moveItems] Error moving item from ${sourceRelative} to ${destinationRelative}:`,
          error,
        );
        return {
          source: sourceOutput,
          destination: destOutput,
          success: false,
          error: `Failed to move item: ${error.message}`,
        };
      }
    }),
  );

  // Process results from Promise.allSettled
  const outputResults: MoveResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      const op = operations[index];
      console.error(
        `[Filesystem MCP - moveItems] Unexpected rejection for operation ${JSON.stringify(op)}:`,
        result.reason,
      );
      return {
        source: (op?.source ?? 'unknown').replace(/\\/g, '/'), // Handle potential undefined
        destination: (op?.destination ?? 'unknown').replace(/\\/g, '/'), // Handle potential undefined
        success: false,
        error: 'Unexpected error during processing.',
      };
    }
  });
  // Sort results based on the original order in the input 'operations' array
  outputResults.sort((a, b) => {
    const indexA = operations.findIndex(
      (op) => op.source.replace(/\\/g, '/') === (a.source ?? ''),
    );
    const indexB = operations.findIndex(
      (op) => op.source.replace(/\\/g, '/') === (b.source ?? ''),
    );
    // Handle cases where source might be missing in error results (though unlikely)
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
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
