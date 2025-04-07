// src/handlers/searchFiles.ts
import type { PathLike } from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { z } from 'zod';
import { glob as globFn } from 'glob';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  resolvePath as resolvePathUtil,
  PROJECT_ROOT as projectRootUtil, // Import the constant again
} from '../utils/pathUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readFile: (p: PathLike, options?: any) => Promise<string>;
  glob: typeof globFn;
  resolvePath: typeof resolvePathUtil;
  PROJECT_ROOT: string; // Expect the constant string again
  pathRelative: (from: string, to: string) => string;
  pathJoin: (...paths: string[]) => string;
}

interface SearchResult {
  file: string;
  line: number;
  match: string;
  context: string[];
}

interface SearchFileParams {
  deps: SearchFilesDependencies;
  absoluteFilePath: string;
  searchRegex: RegExp;
}

const CONTEXT_LINES = 2; // Number of lines before and after the match

// --- Helper Functions ---

/** Parses and validates the input arguments. */
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
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
}

/** Compiles the search regex from the user input string. */
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
    // Ensure 'g' flag is present if not already, for iterating matches
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

/** Finds files to search using glob. */
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
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to find files using glob: ${errorMessage}`,
    );
  }
}

/** Processes a single match found in a file. */
function processFileMatch(
  fileContent: string,
  matchResult: RegExpExecArray,
  fileRelative: string,
): SearchResult {
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
    file: fileRelative,
    line: lineNumber,
    match: match,
    context: context,
  };
}

/** Handles errors during file reading or processing. */
function handleFileReadError(readError: unknown, fileRelative: string): void {
  if (
    readError &&
    typeof readError === 'object' &&
    'code' in readError &&
    readError.code !== 'ENOENT' // Ignore file not found, might be race condition
  ) {
    const message =
      readError instanceof Error ? readError.message : 'Unknown read error';
    console.warn(
      `[Filesystem MCP - searchFiles] Could not read or process file ${fileRelative} during search: ${message}`,
    );
  } else if (
    !(readError && typeof readError === 'object' && 'code' in readError)
  ) {
    // Log non-filesystem errors
    console.warn(
      `[Filesystem MCP - searchFiles] Non-filesystem error processing file ${fileRelative}:`,
      readError,
    );
  }
}

/** Searches content of a single file for regex matches. */
async function searchFileContent(
  params: SearchFileParams,
): Promise<SearchResult[]> {
  const { deps, absoluteFilePath, searchRegex } = params;
  // Use the injected PROJECT_ROOT constant
  const fileRelative = deps
    .pathRelative(deps.PROJECT_ROOT, absoluteFilePath)
    .replace(/\\/g, '/');
  const fileResults: SearchResult[] = [];

  try {
    const fileContent = await deps.readFile(absoluteFilePath, 'utf-8');
    searchRegex.lastIndex = 0; // Reset regex state for global searches

    // Use matchAll for iterating through global regex matches
    const matches = fileContent.matchAll(searchRegex); // searchRegex guaranteed to have 'g' flag by compileSearchRegex

    for (const matchResult of matches) {
      // matchAll guarantees index is present
      // processFileMatch expects RegExpExecArray, which is compatible enough with MatchArray from matchAll
      fileResults.push(
        processFileMatch(
          fileContent,
          matchResult, // Remove unnecessary assertion
          fileRelative,
        ),
      );
    }
  } catch (readError: unknown) {
    handleFileReadError(readError, fileRelative);
  }
  return fileResults;
}

/** Main handler function */
export const handleSearchFilesFunc = async (
  deps: SearchFilesDependencies,
  args: unknown,
): Promise<McpToolResponse> => {
  const {
    path: relativePath,
    regex: regexString,
    file_pattern: filePattern,
  } = parseAndValidateArgs(args);

  const searchRegex = compileSearchRegex(regexString);
  const allResults: SearchResult[] = [];

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
    resultsPerFile.forEach((fileResults) => allResults.push(...fileResults));
  } catch (error: unknown) {
    // Errors from findFilesToSearch or Promise.all rejections
    if (error instanceof McpError) throw error;

    const errorMessage =
      error instanceof Error
        ? error.message
        : 'An unknown error occurred during file search.';
    console.error(
      `[Filesystem MCP - searchFiles] Error during search setup or execution:`,
      error,
    );
    throw new McpError(ErrorCode.InternalError, errorMessage);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(allResults, null, 2) }],
  };
};

// --- Tool Definition ---
export const searchFilesToolDefinition = {
  name: 'search_files',
  description:
    'Search for a regex pattern within files in a specified directory (read-only).',
  schema: SearchFilesArgsSchema,
  handler: (args: unknown): Promise<McpToolResponse> => {
    const deps: SearchFilesDependencies = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      readFile: fsPromises.readFile as any,
      glob: globFn,
      resolvePath: resolvePathUtil,
      PROJECT_ROOT: projectRootUtil, // Inject the constant again
      pathRelative: path.relative.bind(path),
      pathJoin: path.join.bind(path),
    };
    return handleSearchFilesFunc(deps, args);
  },
};
