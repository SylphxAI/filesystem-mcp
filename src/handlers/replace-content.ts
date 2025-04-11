// src/handlers/replaceContent.ts
import { promises as fs, type PathLike, type Stats } from 'node:fs'; // Import necessary types
import { z } from 'zod';
// Import SDK Error/Code from dist, local types for Request/Response
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// Import centralized types
import type { McpToolResponse } from '../types/mcp-types.js';
import { resolvePath } from '../utils/path-utils.js';
import { escapeRegex } from '../utils/string-utils.js'; // Import escapeRegex

// --- Types ---

export const ReplaceOperationSchema = z
  .object({
    search: z.string().describe('Text or regex pattern to search for.'),
    replace: z.string().describe('Text to replace matches with.'),
    use_regex: z.boolean().optional().default(false).describe('Treat search as regex.'),
    ignore_case: z.boolean().optional().default(false).describe('Ignore case during search.'),
  })
  .strict();

export const ReplaceContentArgsSchema = z
  .object({
    paths: z
      .array(z.string())
      .min(1, { message: 'Paths array cannot be empty' })
      .describe('An array of relative file paths to perform replacements on.'),
    operations: z
      .array(ReplaceOperationSchema)
      .min(1, { message: 'Operations array cannot be empty' })
      .describe('An array of search/replace operations to apply to each file.'),
  })
  .strict();

type ReplaceContentArgs = z.infer<typeof ReplaceContentArgsSchema>;
type ReplaceOperation = z.infer<typeof ReplaceOperationSchema>;

export interface ReplaceResult {
  file: string;
  replacements: number;
  modified: boolean;
  error?: string;
}

// --- Define Dependencies Interface ---
export interface ReplaceContentDeps {
  readFile: (path: PathLike, options: BufferEncoding) => Promise<string>;
  writeFile: (path: PathLike, data: string, options: BufferEncoding) => Promise<void>;
  stat: (path: PathLike) => Promise<Stats>;
  resolvePath: typeof resolvePath;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): ReplaceContentArgs {
  try {
    return ReplaceContentArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Assign errors to a typed variable first
      const zodErrors: z.ZodIssue[] = error.errors;
      throw new McpError( // Disable unsafe call for McpError constructor
        ErrorCode.InvalidParams,
        `Invalid arguments: ${zodErrors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    // Determine error message more safely
    let failureMessage = 'Unknown validation error';
    if (error instanceof Error) {
      failureMessage = error.message;
    } else {
      // Attempt to stringify non-Error objects, fallback to String()
      try {
        failureMessage = JSON.stringify(error);
      } catch {
        failureMessage = String(error);
      }
    }
    throw new McpError( // Disable unsafe call for McpError constructor
      ErrorCode.InvalidParams,
      `Argument validation failed: ${failureMessage}`,
    );
  }
}

/** Creates the RegExp object based on operation options. */
function createSearchRegex(op: ReplaceOperation): RegExp | undefined {
  const { search, use_regex, ignore_case } = op;
  let regexFlags = 'g'; // Always global replace within a file
  if (ignore_case) regexFlags += 'i';

  // Add multiline flag ONLY if using regex AND it contains start/end anchors
  if (use_regex && (search.includes('^') || search.includes('$')) && !regexFlags.includes('m')) {
    regexFlags += 'm';
  }

  try {
    return use_regex ? new RegExp(search, regexFlags) : new RegExp(escapeRegex(search), regexFlags); // Escape if not regex
  } catch {
    // Invalid regex pattern - silently return undefined
    return undefined; // Return undefined for invalid regex
  }
}

/** Applies a single replace operation to content. Refactored for complexity. */
function applyReplaceOperation(
  currentContent: string,
  op: ReplaceOperation,
): { newContent: string; replacementsMade: number } {
  const searchRegex = createSearchRegex(op);
  if (!searchRegex) {
    // Treat invalid regex as no match
    return { newContent: currentContent, replacementsMade: 0 };
  }

  const matches = currentContent.match(searchRegex);
  const replacementsInOp = matches ? matches.length : 0;

  let newContent = currentContent;
  if (replacementsInOp > 0) {
    newContent = currentContent.replace(searchRegex, op.replace);
  }

  return { newContent, replacementsMade: replacementsInOp };
}

/** Maps common filesystem error codes to user-friendly messages. */
function mapFsErrorCodeToMessage(code: string, relativePath: string): string | undefined {
  switch (code) {
    case 'ENOENT': {
      return 'File not found';
    }
    case 'EISDIR': {
      return 'Path is not a file';
    }
    case 'EACCES':
    case 'EPERM': {
      return `Permission denied processing file: ${relativePath}`;
    }
    // No default
  }
  return undefined; // Return undefined if code is not specifically handled
}

/** Safely converts an unknown error value to a string. */
function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  // Attempt to stringify non-Error objects, fallback to String()
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Handles errors during file processing for replacement. (Reduced Complexity) */
function handleReplaceError(error: unknown, relativePath: string): string {
  let errorMessage: string;

  // Handle McpError specifically
  if (error instanceof McpError) {
    errorMessage = error.message;
  }
  // Handle common filesystem errors
  else if (error && typeof error === 'object' && 'code' in error) {
    let mappedMessage: string | undefined = undefined;
    if (typeof error.code === 'string' || typeof error.code === 'number') {
      mappedMessage = mapFsErrorCodeToMessage(String(error.code), relativePath);
    }
    errorMessage = mappedMessage ?? `Failed to process file: ${errorToString(error)}`;
  }
  // Handle other errors
  else {
    errorMessage = `Failed to process file: ${errorToString(error)}`;
  }

  // Log the error regardless of type
  // Error processing file - error is returned in the response
  return errorMessage;
}

/** Processes replacements for a single file. */
async function processSingleFileReplacement(
  relativePath: string,
  operations: ReplaceOperation[],
  deps: ReplaceContentDeps,
): Promise<ReplaceResult> {
  const pathOutput = relativePath.replaceAll('\\', '/');
  let targetPath = '';
  let originalContent = '';
  let fileContent = '';
  let totalReplacements = 0;
  let modified = false;

  try {
    targetPath = deps.resolvePath(relativePath);
    const stats = await deps.stat(targetPath);
    if (!stats.isFile()) {
      // Return specific error if path is not a file
      return {
        file: pathOutput,
        replacements: 0,
        modified: false,
        error: 'Path is not a file',
      };
    }

    originalContent = await deps.readFile(targetPath, 'utf8');
    fileContent = originalContent;

    for (const op of operations) {
      const { newContent, replacementsMade } = applyReplaceOperation(fileContent, op);
      // Only update content and count if replacements were actually made
      if (replacementsMade > 0 && newContent !== fileContent) {
        fileContent = newContent;
        totalReplacements += replacementsMade; // Accumulate replacements across operations
      }
    }

    // Check if content actually changed after all operations
    if (fileContent !== originalContent) {
      modified = true;
      await deps.writeFile(targetPath, fileContent, 'utf8');
    }

    return { file: pathOutput, replacements: totalReplacements, modified };
  } catch (error: unknown) {
    // Catch any error during the process (resolve, stat, read, write)
    const fileError = handleReplaceError(error, relativePath);
    return {
      file: pathOutput,
      replacements: totalReplacements, // Return replacements count even on write error
      modified: false,
      error: fileError, // Use the formatted error message
    };
  }
}

/** Processes the results from Promise.allSettled for replace operations. */
// Export for testing
export function processSettledReplaceResults(
  settledResults: PromiseSettledResult<ReplaceResult>[],
  relativePaths: string[],
): ReplaceResult[] {
  return settledResults.map((result, index) => {
    const relativePath = relativePaths[index] ?? 'unknown_path';
    const pathOutput = relativePath.replaceAll('\\', '/');

    return result.status === 'fulfilled'
      ? result.value
      : {
          file: pathOutput,
          replacements: 0,
          modified: false,
          error: `Unexpected error during file processing: ${errorToString(result.reason)}`,
        };
  });
}

/** Processes all file replacements and handles results. */
async function processAllFilesReplacement(
  relativePaths: string[],
  operations: ReplaceOperation[],
  deps: ReplaceContentDeps,
): Promise<ReplaceResult[]> {
  // No try-catch needed here as processSingleFileReplacement handles its errors
  const settledResults = await Promise.allSettled(
    relativePaths.map((relativePath) =>
      processSingleFileReplacement(relativePath, operations, deps),
    ),
  );
  const fileProcessingResults = processSettledReplaceResults(settledResults, relativePaths);

  // Sort results by original path order for predictability
  const originalIndexMap = new Map(relativePaths.map((p, i) => [p.replaceAll('\\', '/'), i]));
  fileProcessingResults.sort((a, b) => {
    const indexA = originalIndexMap.get(a.file) ?? Infinity;
    const indexB = originalIndexMap.get(b.file) ?? Infinity;
    return indexA - indexB;
  });

  return fileProcessingResults;
}

/** Main handler function (internal, accepts dependencies) */
// Export for testing
// Use locally defined McpResponse type
export const handleReplaceContentInternal = async (
  args: unknown,
  deps: ReplaceContentDeps,
): Promise<McpToolResponse> => {
  // Specify output type
  const { paths: relativePaths, operations } = parseAndValidateArgs(args);

  const finalResults = await processAllFilesReplacement(relativePaths, operations, deps);

  // Return results in McpToolResponse format
  return {
    success: true,
    data: {
      results: finalResults,
    },
    content: [
      {
        type: 'text',
        text: JSON.stringify({ results: finalResults }, undefined, 2),
      },
    ],
  };
};

// Export the complete tool definition using the production handler
export const replaceContentToolDefinition = {
  name: 'replace_content',
  description: 'Replace content within files across multiple specified paths.',
  inputSchema: ReplaceContentArgsSchema,
  // Define output schema for better type safety and clarity
  outputSchema: z.object({
    results: z.array(
      z.object({
        file: z.string(),
        replacements: z.number().int(),
        modified: z.boolean(),
        error: z.string().optional(),
      }),
    ),
  }),
  // Use locally defined McpResponse type with proper request type
  handler: async (args: unknown): Promise<McpToolResponse> => {
    // Validate input using schema first
    const validatedArgs = ReplaceContentArgsSchema.parse(args);
    // Production handler provides real dependencies
    const productionDeps: ReplaceContentDeps = {
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      stat: fs.stat,
      resolvePath: resolvePath,
    };
    return handleReplaceContentInternal(validatedArgs, productionDeps);
  },
};
