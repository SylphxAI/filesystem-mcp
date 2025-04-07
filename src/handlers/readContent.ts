// src/handlers/readContent.ts
import { promises as fs, type Stats } from 'fs'; // Import Stats
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath } from '../utils/pathUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

export const ReadContentArgsSchema = z
  .object({
    paths: z
      .array(z.string())
      .min(1, { message: 'Paths array cannot be empty' })
      .describe('Array of relative file paths to read.'),
  })
  .strict();

type ReadContentArgs = z.infer<typeof ReadContentArgsSchema>;

interface ReadResult {
  path: string;
  content?: string;
  error?: string;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): ReadContentArgs {
  try {
    return ReadContentArgsSchema.parse(args);
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

/** Handles filesystem errors during file read or stat. */
function handleFileReadFsError(
  fsError: unknown,
  relativePath: string,
  targetPath: string,
  pathOutput: string,
): ReadResult {
  let errorMessage = `Filesystem error: ${fsError instanceof Error ? fsError.message : String(fsError)}`;
  let specificCode: string | null = null;

  if (fsError && typeof fsError === 'object' && 'code' in fsError) {
    specificCode = String(fsError.code); // Ensure code is string
    if (specificCode === 'ENOENT') {
      errorMessage = `File not found at resolved path '${targetPath}' (from relative path '${relativePath}')`;
    } else if (specificCode === 'EISDIR') {
      errorMessage = `Path is a directory, not a file: ${relativePath}`;
    } else if (specificCode === 'EACCES' || specificCode === 'EPERM') {
      errorMessage = `Permission denied reading file: ${relativePath}`;
    }
  }

  console.error(
    `[Filesystem MCP - readContent] Filesystem error for ${relativePath} at ${targetPath}:`,
    fsError,
  );
  return { path: pathOutput, error: errorMessage };
}

/** Handles errors during path resolution. */
function handlePathResolveError(
  resolveError: unknown,
  relativePath: string,
  pathOutput: string,
): ReadResult {
  const errorMessage =
    resolveError instanceof Error ? resolveError.message : String(resolveError);
  console.error(
    `[Filesystem MCP - readContent] Error resolving path ${relativePath}:`,
    resolveError,
  );
  return { path: pathOutput, error: `Error resolving path: ${errorMessage}` };
}

/** Processes the reading of a single file. */
async function processSingleReadOperation(
  relativePath: string,
): Promise<ReadResult> {
  const pathOutput = relativePath.replace(/\\/g, '/');
  let targetPath = '';
  try {
    targetPath = resolvePath(relativePath);

    try {
      const stats: Stats = await fs.stat(targetPath); // Explicitly type Stats
      if (!stats.isFile()) {
        return {
          path: pathOutput,
          error: `Path is not a regular file: ${relativePath}`,
        };
      }
      const content = await fs.readFile(targetPath, 'utf-8');
      return { path: pathOutput, content: content };
    } catch (fsError: unknown) {
      return handleFileReadFsError(
        fsError,
        relativePath,
        targetPath,
        pathOutput,
      );
    }
  } catch (resolveError: unknown) {
    return handlePathResolveError(resolveError, relativePath, pathOutput);
  }
}

/** Processes results from Promise.allSettled. */
function processSettledResults(
  results: PromiseSettledResult<ReadResult>[],
  originalPaths: string[],
): ReadResult[] {
  return results.map((result, index) => {
    const originalPath = originalPaths[index] ?? 'unknown_path';
    const pathOutput = originalPath.replace(/\\/g, '/');

    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(
        `[Filesystem MCP - readContent] Unexpected rejection for path ${originalPath}:`,
        result.reason,
      );
      return {
        path: pathOutput,
        error: `Unexpected error during processing: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      };
    }
  });
}

/** Main handler function */
const handleReadContentFunc = async (
  args: unknown,
): Promise<McpToolResponse> => {
  const { paths: relativePaths } = parseAndValidateArgs(args);

  const readPromises = relativePaths.map(processSingleReadOperation);
  const settledResults = await Promise.allSettled(readPromises);

  const outputContents = processSettledResults(settledResults, relativePaths);

  // Sort results by original path order for predictability
  const originalIndexMap = new Map(
    relativePaths.map((p, i) => [p.replace(/\\/g, '/'), i]),
  );
  outputContents.sort((a, b) => {
    const indexA = originalIndexMap.get(a.path) ?? Infinity;
    const indexB = originalIndexMap.get(b.path) ?? Infinity;
    return indexA - indexB;
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(outputContents, null, 2) }],
  };
};

// Export the complete tool definition
export const readContentToolDefinition = {
  name: 'read_content',
  description: 'Read content from multiple specified files.',
  schema: ReadContentArgsSchema,
  handler: handleReadContentFunc,
};
