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
 * Handles the 'copy_items' MCP tool request.
 * Copies multiple specified files/directories.
 */
// Removed extra comment marker

// Define Zod schema for individual operations and export it
export const CopyOperationSchema = z
  .object({
    source: z.string().describe('Relative path of the source.'),
    destination: z.string().describe('Relative path of the destination.'),
  })
  .strict();

// Define Zod schema for the main arguments object and export it
export const CopyItemsArgsSchema = z
  .object({
    operations: z
      .array(CopyOperationSchema)
      .min(1, { message: 'Operations array cannot be empty' })
      .describe('Array of {source, destination} objects.'),
  })
  .strict();

// Infer TypeScript type
type CopyItemsArgs = z.infer<typeof CopyItemsArgsSchema>;
// Removed duplicated non-exported schema/type definitions comment

const handleCopyItemsFunc = async (args: unknown): Promise<McpToolResponse> => {
  // Use local type
  // Validate and parse arguments
  let parsedArgs: CopyItemsArgs;
  try {
    parsedArgs = CopyItemsArgsSchema.parse(args);
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
  interface CopyResult {
    source: string;
    destination: string;
    success: boolean;
    error?: string;
  }

  const results = await Promise.allSettled(
    operations.map(async (op): Promise<CopyResult> => {
      const sourceRelative = op.source;
      const destinationRelative = op.destination;
      const sourceOutput = sourceRelative.replace(/\\/g, '/'); // Ensure consistent path separators early
      const destOutput = destinationRelative.replace(/\\/g, '/');
      let sourceAbsolute = ''; // Initialize for potential use in error message

      try {
        sourceAbsolute = resolvePath(sourceRelative); // Assign resolved path
        const destinationAbsolute = resolvePath(destinationRelative);

        if (sourceAbsolute === PROJECT_ROOT) {
          return {
            source: sourceOutput,
            destination: destOutput,
            success: false,
            error: 'Copying the project root is not allowed.',
          };
        }
        // Security Note: resolvePath prevents destinationAbsolute from being outside PROJECT_ROOT

        // Ensure parent directory of destination exists
        const destDir = path.dirname(destinationAbsolute);
        await fs.mkdir(destDir, { recursive: true });

        // Perform the copy (recursive for directories)
        // fs.cp is available in Node 16.7+ and required by project (>=18)
        await fs.cp(sourceAbsolute, destinationAbsolute, {
          recursive: true,
          errorOnExist: false, // Default behavior is to overwrite files
          force: true, // Ensure overwrite even with errorOnExist=false (might be redundant but safe)
        });

        return { source: sourceOutput, destination: destOutput, success: true };
      } catch (error: unknown) {
        // Handle specific Node.js filesystem errors by checking the 'code' property
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof error.code === 'string'
        ) {
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
              error: `Permission denied copying '${sourceRelative}' to '${destinationRelative}'.`,
            };
          }
        }

        // Handle McpError specifically
        if (error instanceof McpError) {
          return {
            source: sourceOutput,
            destination: destOutput,
            success: false,
            error: error.message,
          };
        }

        // Handle generic Error instances
        let errorMessage = 'An unknown error occurred during copy.';
        if (error instanceof Error) {
          errorMessage = `Failed to copy item: ${error.message}`;
        }

        console.error(
          `[Filesystem MCP - copyItems] Error copying item from ${sourceRelative} to ${destinationRelative}:`,
          error, // Log the original error object for debugging
        );

        return {
          source: sourceOutput,
          destination: destOutput,
          success: false,
          error: errorMessage, // Use the determined error message
        };
      }
    }),
  );

  // Process results from Promise.allSettled
  const outputResults: CopyResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      const op = operations[index];
      console.error(
        `[Filesystem MCP - copyItems] Unexpected rejection for operation ${JSON.stringify(op)}:`,
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
export const copyItemsToolDefinition = {
  name: 'copy_items',
  description: 'Copy multiple specified files/directories.',
  schema: CopyItemsArgsSchema,
  handler: handleCopyItemsFunc,
};
