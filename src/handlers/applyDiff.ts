/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { promises as fs, type PathLike } from 'fs';
import { z } from 'zod';
// Correct SDK imports
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from '@modelcontextprotocol/sdk/server'; // Import from server index
// Import locally defined Request/Response types
import type { McpRequest, McpResponse } from './index.js';

import {
  applyDiffInputSchema,
  applyDiffOutputSchema,
  type ApplyDiffInput,
  type ApplyDiffOutput,
  type DiffApplyResult,
  type FileDiff,
  // DiffBlock is used implicitly by FileDiff type, no direct import needed unless used directly
} from '../schemas/applyDiffSchema.js'; // Added .js
import { resolvePath as resolvePathUtil } from '../utils/pathUtils.js'; // Added .js
import { applyDiffsToFileContent } from '../utils/applyDiffUtils.js'; // Added .js

// Define dependencies for injection
export interface ApplyDiffDeps {
  readFile: (path: PathLike, options: BufferEncoding) => Promise<string>;
  writeFile: (
    path: PathLike,
    data: string,
    options: BufferEncoding,
  ) => Promise<void>;
  resolvePath: typeof resolvePathUtil;
  projectRoot: string;
}

// --- Helper Functions ---

// Helper to check for Node.js errors with a string code
function isNodeErrorWithCode(
  error: unknown,
): error is Error & { code: string } {
  // Check instanceof Error first for type narrowing
  return (
    error instanceof Error &&
    typeof error === 'object' && // Keep object check
    'code' in error && // Added missing &&
    typeof error.code === 'string'
  );
}

// Helper to format error messages based on error type
function formatFileProcessingError(
  error: unknown,
  resolvedPath: string | undefined,
  filePath: string, // Original path for context
  projectRoot: string,
): string {
  const safeResolvedPath = resolvedPath ?? 'unknown resolved path';
  const safeFilePath = String(filePath);
  console.error(`Error processing file ${safeFilePath}:`, error);

  if (isNodeErrorWithCode(error)) {
    const nodeErrorCode = error.code; // Safe access due to type guard
    if (nodeErrorCode === 'ENOENT') {
      return `File not found at resolved path: ${safeResolvedPath}. Original path: ${safeFilePath}. Project Root: ${projectRoot}`;
    } else if (nodeErrorCode === 'EACCES' || nodeErrorCode === 'EPERM') {
      return `Permission denied for file: ${safeResolvedPath}. Original path: ${safeFilePath}.`;
    } else {
      // error is narrowed to Error here by the type guard
      return `Filesystem error processing file ${safeFilePath}: ${error.message} (Code: ${nodeErrorCode})`;
    }
  } else if (error instanceof Error) {
    // Generic Error, error is narrowed to Error
    return `Failed to process file ${safeFilePath}: ${error.message}`;
  } else {
    // Unknown error type
    return `Failed to process file ${safeFilePath}: ${String(error)}`;
  }
  // All paths logically return a string
}

// Type guard for FileDiff
function isValidFileDiff(fileDiff: unknown): fileDiff is FileDiff {
  // Basic check for object structure
  if (
    !fileDiff ||
    typeof fileDiff !== 'object' ||
    !('path' in fileDiff) ||
    typeof fileDiff.path !== 'string' ||
    !('diffs' in fileDiff) ||
    !Array.isArray(fileDiff.diffs)
  ) {
    return false;
  }
  // Optionally, add validation for DiffBlock structure within fileDiff.diffs if needed
  return true;
}

// Helper function to read file content
async function readFileContent(
  deps: ApplyDiffDeps,
  resolvedPath: string,
  filePath: string, // Original path for error reporting
): Promise<
  | { success: true; content: string }
  | { success: false; errorResult: DiffApplyResult }
> {
  try {
    const content = await deps.readFile(resolvedPath, 'utf-8');
    return { success: true, content };
  } catch (readError: unknown) {
    // Explicitly type catch variable
    const errorMessage = formatFileProcessingError(
      readError,
      resolvedPath,
      filePath,
      deps.projectRoot,
    );
    // Ensure the returned object matches DiffApplyResult structure
    return {
      success: false,
      errorResult: { path: filePath, success: false, error: errorMessage },
    };
  }
}

// Helper function to write file content
async function writeFileContent(
  deps: ApplyDiffDeps,
  resolvedPath: string,
  filePath: string, // Original path for error reporting
  content: string,
): Promise<
  | { success: true; result: DiffApplyResult }
  | { success: false; errorResult: DiffApplyResult }
> {
  try {
    await deps.writeFile(resolvedPath, content, 'utf-8');
    // Return a success result matching DiffApplyResult structure
    return { success: true, result: { path: filePath, success: true } };
  } catch (writeError: unknown) {
    // Explicitly type catch variable
    const errorMessage = formatFileProcessingError(
      writeError,
      resolvedPath,
      filePath,
      deps.projectRoot,
    );
    // Ensure the returned object matches DiffApplyResult structure
    return {
      success: false,
      errorResult: {
        path: filePath,
        success: false,
        error: `Failed to write changes: ${errorMessage}`,
      },
    };
  }
}

// Applies diffs and potentially writes the file
async function applyDiffAndWriteFile(
  deps: ApplyDiffDeps,
  resolvedPath: string, // Path is guaranteed to be resolved here
  fileDiff: FileDiff, // Assume valid FileDiff is passed
): Promise<DiffApplyResult> {
  // 1. Read File
  const readResult = await readFileContent(deps, resolvedPath, fileDiff.path);
  if (!readResult.success) {
    return readResult.errorResult; // Already DiffApplyResult structure
  }
  const originalContent = readResult.content;

  // 2. Apply Diffs to content
  // Assuming applyDiffsToFileContent returns { success: boolean, newContent?: string, error?: string, context?: string }
  const diffResult = applyDiffsToFileContent(
    originalContent,
    fileDiff.diffs,
    fileDiff.path,
  );

  // 3. Write File if diffs applied successfully
  if (diffResult.success && typeof diffResult.newContent === 'string') {
    // Diff applied successfully, now try to write
    const writeResult = await writeFileContent(
      deps,
      resolvedPath,
      fileDiff.path,
      diffResult.newContent,
    );
    // Return the result from writeFileContent (already DiffApplyResult structure)
    return writeResult.success ? writeResult.result : writeResult.errorResult;
  } else {
    // Diff application failed
    const errorMsg: string =
      typeof diffResult.error === 'string'
        ? diffResult.error
        : 'Unknown diff application error';
    const contextMsg: string | undefined =
      typeof diffResult.context === 'string' ? diffResult.context : undefined;
    // Return DiffApplyResult structure for diff failure
    return {
      path: fileDiff.path,
      success: false,
      error: errorMsg,
      context: contextMsg,
    };
  }
}

// Processes a single file diff, handling path resolution and file operations
async function processSingleFileDiff(
  deps: ApplyDiffDeps,
  fileDiff: FileDiff, // Assume valid FileDiff is passed
): Promise<DiffApplyResult> {
  let resolvedPath: string | undefined; // Initialize as undefined
  try {
    // Resolve path first
    resolvedPath = deps.resolvePath(fileDiff.path, deps.projectRoot);
    // Now call the combined function
    return await applyDiffAndWriteFile(deps, resolvedPath, fileDiff);
  } catch (error: unknown) {
    // Catch any error during resolution or application
    // Handle path resolution errors or errors bubbled up from applyDiffAndWriteFile
    let errorMessage: string;
    if (error instanceof McpError) {
      // McpError likely from resolvePath
      errorMessage = error.message;
    } else if (error instanceof Error) {
      // Safe: error is narrowed to Error
      // Other errors (could be from applyDiffAndWriteFile if it throws unexpectedly)
      errorMessage = `Processing failed: ${error.message}`; // Safe access after instanceof check
    } else {
      errorMessage = `Processing failed: ${String(error)}`;
    }
    // Return DiffApplyResult structure for processing failure
    return {
      path: fileDiff.path, // Use original path from input
      success: false,
      error: errorMessage,
      // Provide context based on whether path resolution failed or not
      context:
        resolvedPath === undefined // Check if path resolution itself failed
          ? `Path resolution failed for ${fileDiff.path}. Project Root: ${deps.projectRoot}`
          : `Error after resolving path ${fileDiff.path} to ${resolvedPath}.`,
    };
  }
}

// --- processSettledResult Logic ---

// Type guard to check if a value is a valid DiffApplyResult
function isDiffApplyResult(value: unknown): value is DiffApplyResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'success' in value &&
    typeof value.success === 'boolean'
  );
}

// Processes a fulfilled promise from Promise.allSettled
function processFulfilledResult(
  settledResultValue: unknown, // This is the value from the fulfilled promise
  index: number,
  changes: readonly FileDiff[], // Original input array for context
): DiffApplyResult {
  // The value should already be a DiffApplyResult from processSingleFileDiff
  if (isDiffApplyResult(settledResultValue)) {
    return settledResultValue;
  } else {
    // This case indicates an internal logic error if processSingleFileDiff behaves correctly
    console.error(
      'Internal error: Unexpected fulfilled value structure:',
      settledResultValue,
    );
    const changeItem = changes[index]; // Get the original input item for path context
    const originalPath = isValidFileDiff(changeItem)
      ? changeItem.path
      : `Unknown Path at index ${String(index)}`; // Explicit string conversion
    return {
      path: originalPath,
      success: false,
      error:
        'Internal error: Unexpected structure in fulfilled promise result.',
    };
  }
}

// Processes a rejected promise from Promise.allSettled
function processRejectedResult(
  settledResultReason: unknown, // This is the reason from the rejected promise
  index: number,
  changes: readonly FileDiff[], // Original input array for context
): DiffApplyResult {
  // This case indicates an internal logic error, as processSingleFileDiff should catch errors
  console.error(
    'Internal error: Unexpected rejection during Promise.allSettled:',
    settledResultReason,
  );
  const errorMsg =
    settledResultReason instanceof Error
      ? `Unexpected internal rejection: ${settledResultReason.message}`
      : `Unexpected internal rejection: ${String(settledResultReason)}`;
  const changeItem = changes[index]; // Get the original input item for path context
  const originalPath = isValidFileDiff(changeItem)
    ? changeItem.path
    : `Unknown Path at index ${String(index)}`; // Explicit string conversion
  return { path: originalPath, success: false, error: errorMsg };
}

// --- Main Handler Logic ---

/**
 * Internal handler function for applying diffs.
 */
export async function handleApplyDiffInternal(
  deps: ApplyDiffDeps,
  requestArgs: ApplyDiffInput, // Assume Zod already validated this structure
): Promise<ApplyDiffOutput> {
  // Validate and filter changes - Safely access requestArgs
  // Access changes safely, assuming requestArgs is validated ApplyDiffInput
  const rawChanges = requestArgs.changes;
  if (!Array.isArray(rawChanges)) {
    // Should not happen if Zod validation is correct, but good practice
    console.warn(
      'handleApplyDiffInternal called with invalid requestArgs.changes type.',
    );
    return { results: [] };
  }

  // Filter for valid FileDiff structures *before* processing
  const changes: readonly FileDiff[] = rawChanges.filter(isValidFileDiff);

  if (changes.length !== rawChanges.length) {
    console.warn(
      `Some invalid FileDiff items were filtered out. Original count: ${String(rawChanges.length)}, Valid count: ${String(changes.length)}`,
    );
    // Decide if this should be an error or just a warning. Currently proceeds.
  }

  if (changes.length === 0) {
    return { results: [] }; // Return empty results if no valid changes remain
  }

  // Process all valid file diffs concurrently
  const settledResults = await Promise.allSettled(
    changes.map((fileDiff) => processSingleFileDiff(deps, fileDiff)),
  );

  // Map settled results back to the expected DiffApplyResult format
  // Ensure the final results array conforms to DiffApplyResult[]
  const results: DiffApplyResult[] = settledResults.map((result, index) =>
    result.status === 'fulfilled'
      ? processFulfilledResult(result.value, index, changes)
      : processRejectedResult(result.reason, index, changes),
  );

  return { results };
}

// --- Tool Definition ---

export const applyDiffTool: ToolDefinition<ApplyDiffInput, ApplyDiffOutput> = {
  name: 'apply_diff',
  description:
    'Applies multiple search/replace diff blocks to multiple files. Changes per file are atomic.',
  inputSchema: applyDiffInputSchema,
  outputSchema: applyDiffOutputSchema,
  handler: async (
    request: McpRequest<ApplyDiffInput>,
  ): Promise<McpResponse<ApplyDiffOutput>> => {
    // Define production dependencies
    const productionDeps: ApplyDiffDeps = {
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      resolvePath: resolvePathUtil,
      projectRoot: process.cwd(),
    };

    try {
      // Zod handles undefined argsToParse based on schema.
      // Safely access arguments using optional chaining.
      const argsToParse = request.params.arguments; // Keep optional chaining for safety
      const validatedArgs = applyDiffInputSchema.parse(argsToParse);

      // Call the internal handler with validated arguments
      const data = await handleApplyDiffInternal(productionDeps, validatedArgs);
      return { success: true, data };
    } catch (error: unknown) {
      // Catch any error
      if (error instanceof z.ZodError) {
        // Handle Zod validation errors
        const formattedErrors = error.errors
          .map((e) => `${e.path.join('.') || 'root'} (${e.message})`)
          .join(', ');
        return {
          success: false,

          error: new McpError(
            ErrorCode.InvalidParams as ErrorCode, // Assert type
            `Invalid arguments: ${formattedErrors}`,
            { validationErrors: error.format() }, // Safe: error is ZodError
          ),
        };
      } else if (error instanceof McpError) {
        // Safe: error is McpError - Already the correct type to return
        return { success: false, error };
      } else {
        // Handle other unexpected errors
        console.error('[applyDiff] Unhandled error:', error);
        // Construct error message safely
        let internalErrMsg = 'Internal error occurred.'; // Default message
        if (error instanceof Error) {
          internalErrMsg = `Internal error: ${error.message}`;
        } else if (typeof error === 'string') {
          internalErrMsg = `Internal error: ${error}`;
        } else {
          // Fallback for other types
          internalErrMsg = `Internal error: ${String(error)}`;
        }
        return {
          success: false,

          error: new McpError(
            ErrorCode.InternalError, // Use imported ErrorCode directly
            internalErrMsg,
          ),
        };
      }
    } // End catch block
  }, // End handler function
}; // End applyDiffTool definition
