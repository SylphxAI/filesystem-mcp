// src/handlers/searchFiles.ts
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { glob as globFn } from 'glob';
// Import SDK types from the correct path
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// Import the LOCAL McpResponse type (assuming it's exported from handlers/index)
import type { McpToolResponse } from '../types/mcp-types.js';
export type LocalMcpResponse = McpToolResponse;
import {
  resolvePath as resolvePathUtil,
  PROJECT_ROOT as projectRootUtil,
} from '../utils/path-utils.js';

// --- Types ---

// Define a unified result type that can hold either a match or an error
interface SearchResultItem {
  type: 'match' | 'error';
  file: string;
  line?: number;
  match?: string;
  context?: string[];
  error?: string; // Error message
  value?: null | undefined; // Explicit null/undefined for compatibility
}

// Define the structure for the final response data
export const SearchFilesArgsSchema = z
  .object({
    path: z
      .string()
      .optional()
      .default('.')
      .describe('Relative path of the directory to search in.'),
    regex: z
      .string()
      .min(1, { message: 'Regex pattern cannot be empty' })
      .describe('The regex pattern to search for.'),
    file_pattern: z
      .string()
      .optional()
      .default('*')
      .describe("Glob pattern to filter files (e.g., '*.ts'). Defaults to all files ('*')."),
  })
  .strict();

type SearchFilesArgs = z.infer<typeof SearchFilesArgsSchema>;

// Type for file reading function
type ReadFileFn = {
  (
    path: Parameters<typeof fsPromises.readFile>[0],
    options?: Parameters<typeof fsPromises.readFile>[1],
  ): Promise<string>;
};

export interface SearchFilesDependencies {
  readFile: ReadFileFn;
  glob: typeof globFn;
  resolvePath: typeof resolvePathUtil;
  PROJECT_ROOT: string;
  pathRelative: typeof path.relative;
  pathJoin: typeof path.join;
}

interface SearchFileParams {
  deps: SearchFilesDependencies;
  absoluteFilePath: string;
  searchRegex: RegExp;
}

const CONTEXT_LINES = 2; // Number of lines before and after the match

// --- Helper Functions ---

function parseAndValidateArgs(args: unknown): SearchFilesArgs {
  try {
    return SearchFilesArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(
      ErrorCode.InvalidParams,
      `Argument validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function compileSearchRegex(regexString: string): RegExp {
  try {
    let pattern = regexString;
    let flags = '';
    const regexFormat = /^\/(.+)\/([gimsuy]*)$/s;
    const regexParts = regexFormat.exec(regexString);
    if (regexParts?.[1] !== undefined) {
      pattern = regexParts[1];
      flags = regexParts[2] ?? '';
    }
    if (!flags.includes('g')) {
      flags += 'g';
    }
    return new RegExp(pattern, flags);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? `Invalid regex pattern: ${error.message}` : 'Invalid regex pattern';
    throw new McpError(ErrorCode.InvalidParams, errorMessage);
  }
}

async function findFilesToSearch(
  deps: SearchFilesDependencies,
  relativePath: string,
  filePattern: string,
): Promise<string[]> {
  const targetPath = deps.resolvePath(relativePath);
  const ignorePattern = deps.pathJoin(targetPath, '**/node_modules/**').replaceAll('\\', '/');
  try {
    const files = await deps.glob(filePattern, {
      cwd: targetPath,
      nodir: true,
      dot: true,
      ignore: [ignorePattern],
      absolute: true,
    });
    return files;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown glob error';
    // Error logged via McpError
    // Throw a more specific error about glob failing
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to find files using glob in '${relativePath}': ${errorMessage}`,
    );
  }
}

function processFileMatch(
  fileContent: string,
  matchResult: RegExpExecArray,
  fileRelative: string,
): SearchResultItem {
  const lines = fileContent.split('\n');
  const match = matchResult[0];
  const matchStartIndex = matchResult.index;

  const contentUpToMatch = fileContent.slice(0, Math.max(0, matchStartIndex));
  const lineNumber = (contentUpToMatch.match(/\n/g) ?? []).length + 1;

  const startContextLineIndex = Math.max(0, lineNumber - 1 - CONTEXT_LINES);
  const endContextLineIndex = Math.min(lines.length, lineNumber + CONTEXT_LINES);
  const context = lines.slice(startContextLineIndex, endContextLineIndex);

  return {
    type: 'match',
    file: fileRelative,
    line: lineNumber,
    match: match,
    context: context,
  };
}

// Refactored to reduce complexity and return an error object
function handleFileReadError(readError: unknown, fileRelative: string): SearchResultItem | null {
  // Check if it's a Node.js error object
  const isNodeError = readError && typeof readError === 'object' && 'code' in readError;

  // Ignore ENOENT errors silently
  if (isNodeError && (readError as NodeJS.ErrnoException).code === 'ENOENT') {
    return { type: 'error', file: '', value: undefined };
  }

  const errorMessage = readError instanceof Error ? readError.message : String(readError);

  // Log appropriately
  if (isNodeError) {
    // Error logged via McpError
  } else {
    // Error logged via McpError
  }

  // Return the error item
  return {
    type: 'error',
    file: fileRelative,
    error: `Read/Process Error: ${String(errorMessage)}`, // Explicit String conversion
  };
}

// Modified to return SearchResultItem[] which includes potential errors
async function searchFileContent(params: SearchFileParams): Promise<SearchResultItem[]> {
  const { deps, absoluteFilePath, searchRegex } = params;
  const fileRelative = deps.pathRelative(deps.PROJECT_ROOT, absoluteFilePath).replaceAll('\\', '/');
  const fileResults: SearchResultItem[] = [];

  try {
    const fileContent = await deps.readFile(absoluteFilePath, 'utf8');
    searchRegex.lastIndex = 0;

    const matches = fileContent.matchAll(searchRegex);

    for (const matchResult of matches) {
      fileResults.push(processFileMatch(fileContent, matchResult, fileRelative));
    }
  } catch (readError: unknown) {
    const errorResult = handleFileReadError(readError, fileRelative);
    if (errorResult) {
      fileResults.push(errorResult); // Add error to results
    }
  }
  return fileResults;
}

/** Main handler function */
// Use the imported local McpResponse type
export const handleSearchFilesFunc = async (
  deps: SearchFilesDependencies,
  args: unknown,
): Promise<LocalMcpResponse> => {
  // Updated response type
  const {
    path: relativePath,
    regex: regexString,
    file_pattern: filePattern,
  } = parseAndValidateArgs(args);

  const searchRegex = compileSearchRegex(regexString);
  const allResults: SearchResultItem[] = [];

  try {
    const filesToSearch = await findFilesToSearch(deps, relativePath, filePattern);

    const searchPromises = filesToSearch.map((absoluteFilePath) =>
      searchFileContent({ deps, absoluteFilePath, searchRegex }),
    );

    const resultsPerFile = await Promise.all(searchPromises);
    // Flatten results (which now include potential errors)
    for (const fileResults of resultsPerFile) allResults.push(...fileResults);
  } catch (error: unknown) {
    // Errors from findFilesToSearch or Promise.all rejections (should be less likely now)
    if (error instanceof McpError) throw error;

    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred during file search.';
    // Error logged via McpError
    // Include a general error if the whole process fails unexpectedly
    allResults.push({ type: 'error', file: 'general', error: errorMessage });
    // Don't throw, return the collected results including the general error
    // throw new McpError(ErrorCode.InternalError, errorMessage);
  }

  // Return the structured data including matches and errors
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ results: allResults }, undefined, 2),
      },
    ],
    data: {
      results: allResults,
    },
  };
};

// --- Tool Definition ---
export const searchFilesToolDefinition = {
  name: 'search_files',
  description:
    'Search for a regex pattern within files in a specified directory (read-only). Returns matches and any errors encountered.',
  inputSchema: SearchFilesArgsSchema,
  // Define output schema
  outputSchema: z.object({
    results: z.array(
      z.object({
        type: z.enum(['match', 'error']),
        file: z.string(),
        line: z.number().int().optional(),
        match: z.string().optional(),
        context: z.array(z.string()).optional(),
        error: z.string().optional(),
      }),
    ),
  }),
  // Use the imported local McpResponse type
  handler: (args: unknown): Promise<LocalMcpResponse> => {
    const deps: SearchFilesDependencies = {
      readFile: async (_path, _options) => {
        const encoding = typeof _options === 'string' ? _options : (_options?.encoding ?? 'utf8');
        return fsPromises.readFile(_path, { encoding });
      },
      glob: globFn,
      resolvePath: resolvePathUtil,
      PROJECT_ROOT: projectRootUtil,
      pathRelative: path.relative.bind(path),
      pathJoin: path.join.bind(path),
    };
    return handleSearchFilesFunc(deps, args);
  },
};
