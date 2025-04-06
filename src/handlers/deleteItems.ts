import { promises as fs } from 'fs';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// Define the expected MCP response structure locally
interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

/**
 * Handles the 'delete_items' MCP tool request.
 * Deletes multiple specified files or directories.
 */

// Define Zod schema and export it
export const DeleteItemsArgsSchema = z
  .object({
    paths: z
      .array(z.string())
      .min(1, { message: 'Paths array cannot be empty' })
      .describe('An array of relative paths (files or directories) to delete.'),
  })
  .strict();

// Infer TypeScript type
type DeleteItemsArgs = z.infer<typeof DeleteItemsArgsSchema>;

// Removed duplicated non-exported schema/type definitions

const handleDeleteItemsFunc = async (
  args: unknown,
): Promise<McpToolResponse> => {
  // Use local type
  // Validate and parse arguments
  let parsedArgs: DeleteItemsArgs;
  try {
    parsedArgs = DeleteItemsArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
  const { paths: pathsToDelete } = parsedArgs;

  // Define result structure
  // Define result structure
  interface DeleteResult {
    path: string;
    success: boolean;
    note?: string;
    error?: string;
  }

  const results = await Promise.allSettled(
    pathsToDelete.map(async (relativePath): Promise<DeleteResult> => {
      const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
      try {
        const targetPath = resolvePath(relativePath);
        if (targetPath === PROJECT_ROOT) {
          return {
            path: pathOutput,
            success: false,
            error: 'Deleting the project root is not allowed.',
          };
        }
        // Remove force: true so ENOENT is thrown for non-existent paths
        await fs.rm(targetPath, { recursive: true });
        return { path: pathOutput, success: true };
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // If the path doesn't exist, consider it a "successful" deletion in the sense that the goal is achieved.
          return {
            path: pathOutput,
            success: true,
            note: 'Path not found, nothing to delete',
          };
        }
        if (error instanceof McpError) {
          return { path: pathOutput, success: false, error: error.message };
        }
        console.error(
          `[Filesystem MCP - deleteItems] Error deleting item ${relativePath}:`,
          error,
        );
        return {
          path: pathOutput,
          success: false,
          error: `Failed to delete: ${error.message}`,
        };
      }
    }),
  );

  // Process results from Promise.allSettled
  const outputResults: DeleteResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - deleteItems] Unexpected rejection for path ${pathsToDelete[index]}:`,
        result.reason,
      );
      return {
        path: (pathsToDelete[index] ?? 'unknown_path').replace(/\\/g, '/'), // Handle potential undefined
        success: false,
        error: 'Unexpected error during processing.',
      };
    }
  });

  // Sort results by original path order for predictability
  outputResults.sort(
    (a, b) =>
      pathsToDelete.indexOf(a.path ?? '') - pathsToDelete.indexOf(b.path ?? ''),
  ); // Handle potential undefined path

  return {
    content: [{ type: 'text', text: JSON.stringify(outputResults, null, 2) }],
  };
};

// Export the complete tool definition
export const deleteItemsToolDefinition = {
  name: 'delete_items',
  description: 'Delete multiple specified files or directories.',
  schema: DeleteItemsArgsSchema,
  handler: handleDeleteItemsFunc,
};
