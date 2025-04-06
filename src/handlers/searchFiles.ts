import type { PathLike } from 'fs';
import { promises as fsPromises } from 'fs'; // Import PathLike
import path from 'path';
import { z } from 'zod';
import { glob as globFn } from 'glob'; // Remove unused GlobOptions import
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  resolvePath as resolvePathUtil,
  PROJECT_ROOT as projectRootUtil,
} from '../utils/pathUtils.js';

// Define the expected MCP response structure locally
interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

/**
 * Handles the 'search_files' MCP tool request.
 * Searches for a regex pattern within files in a specified directory.
 */

// Define Zod schema and export it
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

// Infer TypeScript type
type SearchFilesArgs = z.infer<typeof SearchFilesArgsSchema>;

// Removed duplicated non-exported schema/type definitions

// Define Dependencies Interface
export interface SearchFilesDependencies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readFile: (p: PathLike, options?: any) => Promise<string>; // Reverting to any for simplicity
  glob: typeof globFn; // Use the type of the imported glob function
  resolvePath: typeof resolvePathUtil;
  PROJECT_ROOT: string;
  path: Pick<typeof path, 'relative' | 'join'>; // Only relative and join used
}

export const handleSearchFilesFunc = async (
  deps: SearchFilesDependencies,
  args: unknown,
): Promise<McpToolResponse> => {
  // Use local type
  // Validate and parse arguments
  let parsedArgs: SearchFilesArgs;
  try {
    parsedArgs = SearchFilesArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
  const {
    path: relativePath,
    regex: regexString,
    file_pattern: filePattern,
  } = parsedArgs;

  if (typeof regexString !== 'string' || regexString.trim() === '') {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Missing or invalid required parameter: regex',
    );
  }

  let searchRegex: RegExp;
  try {
    // Correctly parse pattern and flags, respecting user input
    let pattern = regexString;
    let flags = '';
    // Check if the input looks like /pattern/flags format using exec
    const regexFormat = /^\/(.+)\/([gimyus]*)$/s; // Added 's' flag support
    const regexParts = regexFormat.exec(regexString);
    // Use optional chaining as suggested by ESLint
    if (regexParts?.[1] !== undefined) {
      // Ensure group 1 (pattern) exists before assigning
      pattern = regexParts[1];
      flags = regexParts[2] ?? ''; // Group 2 (flags) might be undefined, default to empty string
    }
    // If regexParts is null or group 1 is undefined, pattern remains the original regexString, flags remain ''
    // Create RegExp with extracted pattern and flags
    searchRegex = new RegExp(pattern, flags);
  } catch (error: unknown) {
    // Catch potential errors from new RegExp()
    let errorMessage = 'Invalid regex pattern';
    if (error instanceof Error) {
      errorMessage = `Invalid regex pattern: ${error.message}`;
    }
    throw new McpError(ErrorCode.InvalidParams, errorMessage);
  }

  // Define result structure
  interface SearchResult {
    file: string;
    line: number;
    match: string;
    context: string[];
  }
  const results: SearchResult[] = [];
  const CONTEXT_LINES = 2; // Number of lines before and after the match to include

  let targetPath = ''; // Initialize for use in catch block
  try {
    targetPath = deps.resolvePath(relativePath);
    // Use targetPath as cwd for glob
    const globPattern = filePattern; // Pattern is now relative to cwd
    const ignorePattern = deps.path
      .join(targetPath, '**/node_modules/**')
      .replace(/\\/g, '/'); // Still need absolute ignore path
    const files = await deps.glob(globPattern, {
      cwd: targetPath,
      nodir: true,
      dot: true,
      ignore: [ignorePattern],
      absolute: true, // Get absolute paths back for reading
    });

    for (const absoluteFilePath of files) {
      const fileRelative = deps.path
        .relative(deps.PROJECT_ROOT, absoluteFilePath)
        .replace(/\\/g, '/');
      try {
        const fileContent = await deps.readFile(absoluteFilePath, 'utf-8');
        const lines = fileContent.split('\n');

        // Execute regex on the entire file content for multi-line support
        // let matchResult; // Remove duplicate declaration
        if (searchRegex.global) searchRegex.lastIndex = 0; // Reset for global search

        // Execute regex on the entire file content for multi-line support
        let matchResult;
        // Reset lastIndex *before* the loop for global regex
        if (searchRegex.global) {
          searchRegex.lastIndex = 0;
        }

        while ((matchResult = searchRegex.exec(fileContent)) !== null) {
          const match = matchResult[0];
          const matchStartIndex = matchResult.index;

          // Determine the line number of the match start
          const contentUpToMatch = fileContent.substring(0, matchStartIndex);
          const lineNumber = (contentUpToMatch.match(/\n/g) || []).length + 1; // 1-based line number

          // Determine context lines
          const startContextLineIndex = Math.max(
            0,
            lineNumber - 1 - CONTEXT_LINES,
          );
          const endContextLineIndex = Math.min(
            lines.length,
            lineNumber + CONTEXT_LINES,
          );
          const context = lines.slice(
            startContextLineIndex,
            endContextLineIndex,
          );

          results.push({
            file: fileRelative,
            line: lineNumber,
            match: match,
            context: context,
          });

          // If the regex is not global, stop after the first match.
          if (!searchRegex.global) {
            break;
          }

          // According to MDN, for global regex with zero-length matches,
          // the exec() method itself should advance lastIndex.
          // No manual advancement needed here.
        }
      } catch (readError: unknown) {
        // Ignore errors reading specific files (e.g., permission denied, binary files)
        // Check if it's a Node.js error with a code property
        if (
          readError &&
          typeof readError === 'object' &&
          'code' in readError &&
          readError.code !== 'ENOENT' // Don't warn if file disappeared
        ) {
          const message =
            readError instanceof Error
              ? readError.message
              : 'Unknown read error';
          console.warn(
            `[Filesystem MCP - searchFiles] Could not read or process file ${fileRelative} during search: ${message}`,
          );
        } else if (
          !(readError && typeof readError === 'object' && 'code' in readError)
        ) {
          // Log other types of errors if they are not Node.js file system errors
          console.warn(
            `[Filesystem MCP - searchFiles] Non-filesystem error processing file ${fileRelative}:`,
            readError,
          );
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof McpError) throw error; // Re-throw specific McpErrors (e.g., from resolvePath)

    let errorMessage = 'An unknown error occurred during file search.';
    if (error instanceof Error) {
      errorMessage = `Failed to search files: ${error.message}`;
    }
    console.error(
      `[Filesystem MCP - searchFiles] Error searching files in ${relativePath} (resolved: ${targetPath}):`,
      error, // Log the original error
    );
    throw new McpError(ErrorCode.InternalError, errorMessage);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
  };
};

// Export the complete tool definition
export const searchFilesToolDefinition = {
  name: 'search_files',
  description:
    'Search for a regex pattern within files in a specified directory (read-only).',
  schema: SearchFilesArgsSchema,
  // The production handler needs to provide the dependencies
  handler: (args: unknown) => {
    const deps: SearchFilesDependencies = {
      readFile: fsPromises.readFile,
      glob: globFn,
      resolvePath: resolvePathUtil,
      PROJECT_ROOT: projectRootUtil,
      path: { relative: path.relative, join: path.join },
    };
    return handleSearchFilesFunc(deps, args);
  },
};
