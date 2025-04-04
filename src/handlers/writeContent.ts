import { promises as fs } from "fs";
import path from "path";
import { z } from 'zod';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

/**
 * Handles the 'write_content' MCP tool request.
 * Writes or appends content to multiple specified files.
 */

// Define Zod schema for individual items
const WriteItemSchema = z.object({
  path: z.string(),
  content: z.string(),
  append: z.boolean().optional().default(false),
}).strict();

// Define Zod schema for the main arguments object
const WriteContentArgsSchema = z.object({
  items: z.array(WriteItemSchema).min(1, { message: "Items array cannot be empty" }),
}).strict();

// Infer TypeScript type from schema
type WriteContentArgs = z.infer<typeof WriteContentArgsSchema>;

export const handleWriteContent = async (args: unknown) => {
  // Validate and parse arguments
  let parsedArgs: WriteContentArgs;
  try {
      parsedArgs = WriteContentArgsSchema.parse(args);
  } catch (error) {
      if (error instanceof z.ZodError) {
          throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${error.errors.map(e => `${e.path.join('.')} (${e.message})`).join(', ')}`);
      }
      throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
  const { items: filesToWrite } = parsedArgs;

  // Define result structure
  // Define result structure
  type WriteResult = {
      path: string;
      success: boolean;
      operation?: 'written' | 'appended';
      error?: string;
  };

  const results = await Promise.allSettled(filesToWrite.map(async (file): Promise<WriteResult> => {
    const relativePath = file.path;
    const content = file.content;
    const append = file.append ?? false; // Check for append flag
    const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early

    try {
        const targetPath = resolvePath(relativePath);
        if (targetPath === PROJECT_ROOT) {
            return { path: pathOutput, success: false, error: 'Writing directly to the project root is not allowed.' };
        }
        const targetDir = path.dirname(targetPath);
        await fs.mkdir(targetDir, { recursive: true });

        if (append) {
            await fs.appendFile(targetPath, content, 'utf-8');
            return { path: pathOutput, success: true, operation: 'appended' };
        } else {
            await fs.writeFile(targetPath, content, 'utf-8');
            return { path: pathOutput, success: true, operation: 'written' };
        }
    } catch (error: any) {
        if (error instanceof McpError) {
            return { path: pathOutput, success: false, error: error.message };
        }
        console.error(`[Filesystem MCP - writeContent] Error writing file ${relativePath}:`, error);
        return { path: pathOutput, success: false, error: `Failed to ${append ? 'append' : 'write'} file: ${error.message}` };
    }
  }));

  // Process results from Promise.allSettled
  const outputResults: WriteResult[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
          return result.value;
      } else {
          console.error(`[Filesystem MCP - writeContent] Unexpected rejection for path ${filesToWrite[index]?.path}:`, result.reason);
          return { path: filesToWrite[index]?.path?.replace(/\\/g, '/') ?? 'unknown', success: false, error: 'Unexpected error during processing.' };
      }
  });

  // Sort results by original path order for predictability
  // Sort results based on the original order in the input 'items' array
  outputResults.sort((a, b) => {
      const indexA = filesToWrite.findIndex(f => f.path.replace(/\\/g, '/') === (a.path ?? ''));
      const indexB = filesToWrite.findIndex(f => f.path.replace(/\\/g, '/') === (b.path ?? ''));
      // Handle cases where path might be missing in error results (though unlikely)
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
  });


  return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};