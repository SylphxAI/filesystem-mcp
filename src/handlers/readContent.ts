import { promises as fs } from "fs";
import { z } from 'zod';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

/**
 * Handles the 'read_content' MCP tool request.
 * Reads content from multiple specified files.
 */

// Define Zod schema and export it
export const ReadContentArgsSchema = z.object({
  paths: z.array(z.string()).min(1, { message: "Paths array cannot be empty" }).describe("Array of relative file paths to read."),
}).strict();

// Infer TypeScript type
type ReadContentArgs = z.infer<typeof ReadContentArgsSchema>;

// Removed duplicated non-exported schema/type definitions

const handleReadContentFunc = async (args: unknown) => {
  // Validate and parse arguments
  let parsedArgs: ReadContentArgs;
  try {
      parsedArgs = ReadContentArgsSchema.parse(args);
  } catch (error) {
      if (error instanceof z.ZodError) {
          throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${error.errors.map(e => `${e.path.join('.')} (${e.message})`).join(', ')}`);
      }
      throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
  const { paths: relativePaths } = parsedArgs;

  // Define result structure
  // Define result structure
  type ReadResult = {
      path: string;
      content?: string;
      error?: string;
  };

  const results = await Promise.allSettled(relativePaths.map(async (relativePath): Promise<ReadResult> => {
    const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
    let targetPath: string = ''; // Declare outside try block for catch scope
    try {
      const targetPath = resolvePath(relativePath);
      const stats = await fs.stat(targetPath);
      if (!stats.isFile()) {
          return { path: pathOutput, error: `Path is not a file` };
      }
      const content = await fs.readFile(targetPath, 'utf-8');
      return { path: pathOutput, content: content };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
          // Include more context for ENOENT errors
          return { path: pathOutput, error: `File not found at resolved path '${targetPath}' (from relative path '${relativePath}', project root: '${PROJECT_ROOT}')` };
      }
      if (error instanceof McpError) {
          return { path: pathOutput, error: error.message };
      }
      console.error(`[Filesystem MCP - readContent] Error reading file ${relativePath}:`, error);
      return { path: pathOutput, error: `Failed to read file: ${error.message}` };
    }
  }));

  // Process results from Promise.allSettled
  const outputContents: ReadResult[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
          return result.value;
      } else {
          // Handle rejected promises (should ideally not happen with current try/catch)
          console.error(`[Filesystem MCP - readContent] Unexpected rejection for path ${relativePaths[index]}:`, result.reason);
          return { path: relativePaths[index].replace(/\\/g, '/'), error: 'Unexpected error during processing.' };
      }
  });

  // Sort results by original path order for predictability
  outputContents.sort((a, b) => relativePaths.indexOf(a.path ?? '') - relativePaths.indexOf(b.path ?? '')); // Handle potential undefined path in sort

  return { content: [{ type: "text", text: JSON.stringify(outputContents, null, 2) }] };
};

// Export the complete tool definition
export const readContentToolDefinition = {
    name: "read_content",
    description: "Read content from multiple specified files.",
    schema: ReadContentArgsSchema,
    handler: handleReadContentFunc,
};