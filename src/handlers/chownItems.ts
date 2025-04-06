import { promises as fs } from 'fs';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// Define the expected MCP response structure locally
interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

/**
 * Handles the 'chown_items' MCP tool request.
 * Changes owner (UID) and group (GID) for multiple specified files/directories.
 * Note: This may have limited effect or require specific permissions on non-POSIX systems like Windows.
 */

// Define Zod schema and export it
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

// Infer TypeScript type
type ChownItemsArgs = z.infer<typeof ChownItemsArgsSchema>;

// Removed duplicated non-exported schema/type definitions

const handleChownItemsFunc = async (
  args: unknown,
): Promise<McpToolResponse> => {
  // Use local type
  // Validate and parse arguments
  let parsedArgs: ChownItemsArgs;
  try {
    parsedArgs = ChownItemsArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
  const { paths: relativePaths, uid, gid } = parsedArgs;

  // Note: fs.chown might not work reliably or as expected on Windows.
  // It might require administrator privileges or specific system configurations.

  // Define result structure
  // Define result structure
  interface ChownResult {
    path: string;
    success: boolean;
    uid?: number; // Include uid/gid on success
    gid?: number;
    error?: string;
  }

  const results = await Promise.allSettled(
    relativePaths.map(async (relativePath): Promise<ChownResult> => {
      const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
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
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return { path: pathOutput, success: false, error: 'Path not found' };
        }
        if (error.code === 'EPERM') {
          // Common error on Windows or insufficient permissions
          return {
            path: pathOutput,
            success: false,
            error: 'Operation not permitted (Permissions or unsupported on OS)',
          };
        }
        if (error instanceof McpError) {
          return { path: pathOutput, success: false, error: error.message };
        }
        console.error(
          `[Filesystem MCP - chownItems] Error changing ownership for ${relativePath}:`,
          error,
        );
        return {
          path: pathOutput,
          success: false,
          error: `Failed to change ownership: ${error.message}`,
        };
      }
    }),
  );

  // Process results from Promise.allSettled
  const outputResults: ChownResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - chownItems] Unexpected rejection for path ${relativePaths[index]}:`,
        result.reason,
      );
      return {
        path: (relativePaths[index] ?? 'unknown_path').replace(/\\/g, '/'), // Handle potential undefined
        success: false,
        error: 'Unexpected error during processing.',
      };
    }
  });

  // Sort results by original path order for predictability
  outputResults.sort(
    (a, b) =>
      relativePaths.indexOf(a.path ?? '') - relativePaths.indexOf(b.path ?? ''),
  ); // Handle potential undefined path

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
