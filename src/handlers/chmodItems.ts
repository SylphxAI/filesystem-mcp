import { promises as fs } from 'fs';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

// Define the expected MCP response structure locally
interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

/**
 * Handles the 'chmod_items' MCP tool request.
 * Changes permissions mode for multiple specified files/directories.
 */

// Define Zod schema and export it
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

// Infer TypeScript type
type ChmodItemsArgs = z.infer<typeof ChmodItemsArgsSchema>;

// Removed duplicated non-exported schema/type definitions

const handleChmodItemsFunc = async (
  args: unknown,
): Promise<McpToolResponse> => {
  // Use local type
  // Validate and parse arguments
  let parsedArgs: ChmodItemsArgs;
  try {
    parsedArgs = ChmodItemsArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
  const { paths: relativePaths, mode: modeString } = parsedArgs;
  const mode = parseInt(modeString, 8);

  // Define result structure
  interface ChmodResult {
    path: string;
    success: boolean;
    mode?: string; // Include mode on success
    error?: string;
  }
  const results = await Promise.allSettled(
    relativePaths.map(async (relativePath): Promise<ChmodResult> => {
      const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
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
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return { path: pathOutput, success: false, error: 'Path not found' };
        }
        if (error instanceof McpError) {
          return { path: pathOutput, success: false, error: error.message };
        }
        // Note: EPERM might occur on Windows or if user lacks permissions
        console.error(
          `[Filesystem MCP - chmodItems] Error changing mode for ${relativePath}:`,
          error,
        );
        return {
          path: pathOutput,
          success: false,
          error: `Failed to change mode: ${error.message}`,
        };
      }
    }),
  );

  // Process results from Promise.allSettled
  const outputResults: ChmodResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - chmodItems] Unexpected rejection for path ${relativePaths[index]}:`,
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
export const chmodItemsToolDefinition = {
  name: 'chmod_items',
  description:
    'Change permissions mode for multiple specified files/directories (POSIX-style).',
  schema: ChmodItemsArgsSchema,
  handler: handleChmodItemsFunc,
};
