// src/handlers/searchFiles.ts
import type { PathLike } from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { z } from 'zod';
import { glob as globFn } from 'glob';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  resolvePath as resolvePathUtil,
  PROJECT_ROOT as projectRootUtil,
} from '../utils/pathUtils.js';

// --- Types ---

// Define a unified result type that can hold either a match or an error
interface SearchResultItem {
  type: 'match' | 'error';
  file: string;
  line?: number;
  match?: string;
  context?: string[];
  error?: string; // Error message
}

// Define the structure for the final response data
interface SearchFilesResponseData {
  results: SearchResultItem[];
}

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
      .describe(
        "Glob pattern to filter files (e.g., '*.ts'). Defaults to all files ('*').",
      ),
  })
  .strict();

type SearchFilesArgs = z.infer<typeof SearchFilesArgsSchema>;

export interface SearchFilesDependencies {
  readFile: (p: PathLike, options?: any) => Promise<string>;
  glob: typeof globFn;
  resolvePath: typeof resolvePathUtil;
  PROJECT_ROOT: string;
  pathRelative: (from: string, to: string) => string;
  pathJoin: (...paths: string[]) => string;
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
    const regexFormat = /^\/(.+)\/([gimyus]*)$/s;
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
      error instanceof Error
        ? `Invalid regex pattern: ${error.message}`
        : 'Invalid regex pattern';
    throw new McpError(ErrorCode.InvalidParams, errorMessage);
  }
}

async function findFilesToSearch(
  deps: SearchFilesDependencies,
  relativePath: string,
  filePattern: string,
): Promise<string[]> {
  const targetPath = deps.resolvePath(relativePath);
  const ignorePattern = deps
    .pathJoin(targetPath, '**/node_modules/**')
    .replace(/\\/g, '/');
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
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown glob error';
    console.error(
      `[Filesystem MCP - searchFiles] Glob error in ${targetPath}:`,
      error,
    );
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

  const contentUpToMatch = fileContent.substring(0, matchStartIndex);
  const lineNumber = (contentUpToMatch.match(/\n/g) ?? []).length + 1;

  const startContextLineIndex = Math.max(0, lineNumber - 1 - CONTEXT_LINES);
  const endContextLineIndex = Math.min(
    lines.length,
    lineNumber + CONTEXT_LINES,
  );
  const context = lines.slice(startContextLineIndex, endContextLineIndex);

  return {
    type: 'match',
    file: fileRelative,
    line: lineNumber,
    match: match,
    context: context,
  };
}

// Modified to return an error object instead of logging to console
function handleFileReadError(
  readError: unknown,
  fileRelative: string,
): SearchResultItem | null {
  let errorMessage: string | null = null;
  if (
    readError &&
    typeof readError === 'object' &&
    'code' in readError &&
    readError.code !== 'ENOENT' // Ignore file not found
  ) {
    errorMessage =
      readError instanceof Error ? readError.message : 'Unknown read error';
    console.warn(
      `[Filesystem MCP - searchFiles] Could not read or process file ${fileRelative} during search: ${errorMessage}`,
    );
  } else if (
    !(readError && typeof readError === 'object' && 'code' in readError)
  ) {
    // Log and capture non-filesystem errors
    errorMessage =
      readError instanceof Error ? readError.message : String(readError);
    console.warn(
      `[Filesystem MCP - searchFiles] Non-filesystem error processing file ${fileRelative}:`,
      readError,
    );
  }

  if (errorMessage) {
    return {
      type: 'error',
      file: fileRelative,
      error: `Read/Process Error: ${errorMessage}`,
    };
  }
  return null; // Indicate no reportable error occurred
}

// Modified to return SearchResultItem[] which includes potential errors
async function searchFileContent(
  params: SearchFileParams,
): Promise<SearchResultItem[]> {
  const { deps, absoluteFilePath, searchRegex } = params;
  const fileRelative = deps
    .pathRelative(deps.PROJECT_ROOT, absoluteFilePath)
    .replace(/\\/g, '/');
  const fileResults: SearchResultItem[] = [];

  try {
    const fileContent = await deps.readFile(absoluteFilePath, 'utf-8');
    searchRegex.lastIndex = 0;

    const matches = fileContent.matchAll(searchRegex);

    for (const matchResult of matches) {
      fileResults.push(
        processFileMatch(fileContent, matchResult, fileRelative),
      );
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
export const handleSearchFilesFunc = async (
  deps: SearchFilesDependencies,
  args: unknown,
): Promise<McpResponse<SearchFilesResponseData>> => {
  // Updated response type
  const {
    path: relativePath,
    regex: regexString,
    file_pattern: filePattern,
  } = parseAndValidateArgs(args);

  const searchRegex = compileSearchRegex(regexString);
  const allResults: SearchResultItem[] = [];

  try {
    const filesToSearch = await findFilesToSearch(
      deps,
      relativePath,
      filePattern,
    );

    const searchPromises = filesToSearch.map((absoluteFilePath) =>
      searchFileContent({ deps, absoluteFilePath, searchRegex }),
    );

    const resultsPerFile = await Promise.all(searchPromises);
    // Flatten results (which now include potential errors)
    resultsPerFile.forEach((fileResults) => allResults.push(...fileResults));
  } catch (error: unknown) {
    // Errors from findFilesToSearch or Promise.all rejections (should be less likely now)
    if (error instanceof McpError) throw error;

    const errorMessage =
      error instanceof Error
        ? error.message
        : 'An unknown error occurred during file search.';
    console.error(
      `[Filesystem MCP - searchFiles] Error during search setup or execution:`,
      error,
    );
    // Include a general error if the whole process fails unexpectedly
    allResults.push({ type: 'error', file: 'general', error: errorMessage });
    // Don't throw, return the collected results including the general error
    // throw new McpError(ErrorCode.InternalError, errorMessage);
  }

  // Return the structured data including matches and errors
  return {
    success: true,
    data: { results: allResults },
  };
};

// --- Tool Definition ---
export const searchFilesToolDefinition = {
  name: 'search_files',
  description:
    'Search for a regex pattern within files in a specified directory (read-only). Returns matches and any errors encountered.',
  schema: SearchFilesArgsSchema,
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
  handler: (args: unknown): Promise<McpResponse<SearchFilesResponseData>> => {
    const deps: SearchFilesDependencies = {
      readFile: fsPromises.readFile as any,
      glob: globFn,
      resolvePath: resolvePathUtil,
      PROJECT_ROOT: projectRootUtil,
      pathRelative: path.relative.bind(path),
      pathJoin: path.join.bind(path),
    };
    return handleSearchFilesFunc(deps, args);
  },
};
