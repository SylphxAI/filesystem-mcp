import { promises as fs } from "fs";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath } from '../utils/pathUtils.js'; // Use .js extension

/**
 * Handles the 'read_content' MCP tool request.
 * Reads content from multiple specified files.
 */
export const handleReadContent = async (args: any) => {
  const relativePaths = args?.paths;
  if (!Array.isArray(relativePaths) || relativePaths.length === 0 || !relativePaths.every(p => typeof p === 'string')) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
  }

  // Define result structure
  type ReadResult = {
      path: string;
      content?: string;
      error?: string;
  };

  const results = await Promise.allSettled(relativePaths.map(async (relativePath): Promise<ReadResult> => {
    const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
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
          return { path: pathOutput, error: `File not found` };
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
  outputContents.sort((a, b) => relativePaths.indexOf(a.path) - relativePaths.indexOf(b.path));

  return { content: [{ type: "text", text: JSON.stringify(outputContents, null, 2) }] };
};