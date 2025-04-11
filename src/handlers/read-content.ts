// src/handlers/readContent.ts
import { promises as fs, type Stats } from 'node:fs'; // Import Stats
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath } from '../utils/path-utils.js';

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
    start_line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Optional 1-based starting line number'),
    end_line: z.number().int().min(1).optional().describe('Optional 1-based ending line number'),
    format: z
      .enum(['raw', 'lines'])
      .default('lines')
      .describe('Output format - "raw" for plain text, "lines" for line objects'),
  })
  .strict();

type ReadContentArgs = z.infer<typeof ReadContentArgsSchema>;

interface ReadResult {
  path: string;
  content?: string | { lineNumber: number; content: string }[];
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
interface FileReadErrorOptions {
  pathOutput: string;
  relativePath?: string;
  targetPath?: string;
}

function getBasicFsErrorMessage(fsError: unknown): string {
  return `Filesystem error: ${fsError instanceof Error ? fsError.message : String(fsError)}`;
}

function getSpecificFsErrorMessage(
  code: string,
  relativePath?: string,
  targetPath?: string,
): string | undefined {
  switch (code) {
    case 'ENOENT': {
      return targetPath
        ? `File not found at resolved path '${targetPath}'${relativePath ? ` (from relative path '${relativePath}')` : ''}`
        : 'File not found';
    }
    case 'EISDIR': {
      return relativePath
        ? `Path is a directory, not a file: ${relativePath}`
        : 'Path is a directory, not a file';
    }
    case 'EACCES':
    case 'EPERM': {
      return relativePath
        ? `Permission denied reading file: ${relativePath}`
        : 'Permission denied reading file';
    }
    default: {
      return undefined;
    }
  }
}

function getFsErrorMessage(fsError: unknown, relativePath?: string, targetPath?: string): string {
  if (!fsError || typeof fsError !== 'object' || !('code' in fsError)) {
    return getBasicFsErrorMessage(fsError);
  }

  const specificMessage = getSpecificFsErrorMessage(String(fsError.code), relativePath, targetPath);
  return specificMessage || getBasicFsErrorMessage(fsError);
}

function handleFileReadFsError(fsError: unknown, options: FileReadErrorOptions): ReadResult {
  const { pathOutput, relativePath, targetPath } = options;
  const errorMessage = getFsErrorMessage(fsError, relativePath, targetPath);
  return { path: pathOutput, error: errorMessage };
}

/** Handles errors during path resolution. */
function handlePathResolveError(
  resolveError: unknown,
  _relativePath: string,
  pathOutput: string,
): ReadResult {
  const errorMessage = resolveError instanceof Error ? resolveError.message : String(resolveError);
  // Error logged via McpError
  return { path: pathOutput, error: `Error resolving path: ${errorMessage}` };
}
/** Processes the reading of a single file. */
interface ReadOperationOptions {
  startLine?: number | undefined;
  endLine?: number | undefined;
  format?: 'raw' | 'lines';
}

async function processSingleReadOperation(
  _relativePath: string,
  options: ReadOperationOptions = {},
): Promise<ReadResult> {
  const { startLine, endLine, format } = options;
  const pathOutput = _relativePath.replaceAll('\\', '/');
  let targetPath = '';
  try {
    targetPath = resolvePath(_relativePath);
    try {
      const stats: Stats = await fs.stat(targetPath); // Explicitly type Stats
      if (!stats.isFile()) {
        return {
          path: pathOutput,
          error: `Path is not a regular file: ${_relativePath}`,
        };
      }
      if (startLine !== undefined || endLine !== undefined) {
        // Read file line by line when line range is specified
        const fileContent = await fs.readFile(targetPath, 'utf8');
        const lines = fileContent.split('\n');
        const start = startLine ? Math.min(startLine - 1, lines.length) : 0;
        const end = endLine ? Math.min(endLine, lines.length) : lines.length;
        const filteredLines = lines.slice(start, end);
        const content =
          format === 'raw'
            ? filteredLines.join('\n')
            : filteredLines.map((line, i) => ({
                lineNumber: start + i + 1,
                content: line,
              }));
        return { path: pathOutput, content };
      } else {
        // Read entire file when no line range specified
        const content = await fs.readFile(targetPath, 'utf8');
        return { path: pathOutput, content: content };
      }
    } catch (fsError: unknown) {
      return handleFileReadFsError(fsError, {
        pathOutput,
        relativePath: _relativePath,
        targetPath,
      });
    }
  } catch (resolveError: unknown) {
    return handlePathResolveError(resolveError, _relativePath, pathOutput);
  }
}

/** Processes results from Promise.allSettled. */
function processSettledResults(
  results: PromiseSettledResult<ReadResult>[],
  originalPaths: string[],
): ReadResult[] {
  return results.map((result, index) => {
    const originalPath = originalPaths[index] ?? 'unknown_path';
    const pathOutput = originalPath.replaceAll('\\', '/');

    return result.status === 'fulfilled'
      ? result.value
      : {
          path: pathOutput,
          error: `Unexpected error during processing: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        };
  });
}

/** Main handler function */
const handleReadContentFunc = async (args: unknown): Promise<McpToolResponse> => {
  const { paths: relativePaths, start_line, end_line, format } = parseAndValidateArgs(args);

  const readPromises = relativePaths.map((path) =>
    processSingleReadOperation(path, { startLine: start_line, endLine: end_line, format }),
  );
  const settledResults = await Promise.allSettled(readPromises);

  const outputContents = processSettledResults(settledResults, relativePaths);

  // Sort results by original path order for predictability
  const originalIndexMap = new Map(relativePaths.map((p, i) => [p.replaceAll('\\', '/'), i]));
  outputContents.sort((a, b) => {
    const indexA = originalIndexMap.get(a.path) ?? Infinity;
    const indexB = originalIndexMap.get(b.path) ?? Infinity;
    return indexA - indexB;
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(outputContents, undefined, 2) }],
  };
};

// Export the complete tool definition
export const readContentToolDefinition = {
  name: 'read_content',
  description: 'Read content from multiple specified files.',
  inputSchema: ReadContentArgsSchema,
  handler: handleReadContentFunc,
};
