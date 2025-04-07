// src/handlers/editFile.ts
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { PathLike, WriteFileOptions } from 'fs'; // Added types
import { createPatch } from 'diff'; // Added import
import { promises as fs } from 'fs'; // Added import
import type { ToolDefinition } from './index.js';
import {
  readFileContentForEdit,
  applyAllChangesToContent,
  // finalizeFileProcessing, // Removed import
  type EditFileChange,
  type EditFileResultItem,
  type FinalizeState,
  type FinalizePaths,
  type FinalizeOptions,
} from '../utils/editFileUtils.js';

// Re-define the expected MCP response structure locally
interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

// --- Zod Schema Definition ---

const EditFileChangeSchema = z
  .object({
    path: z.string().min(1).describe('Relative path to the file to modify.'),
    search_pattern: z
      .string()
      .optional()
      .describe(
        'Multi-line text or regex pattern to find the block to replace or delete. If empty or omitted, implies insertion at start_line.',
      ),
    start_line: z
      .number()
      .int()
      .min(1)
      .describe(
        'The 1-based line number where the search_pattern is expected to start, or where insertion should occur.',
      ),
    replace_content: z
      .string()
      .optional()
      .describe(
        'The content to replace the matched block with. If omitted and search_pattern is present, it deletes the matched block. Required for insertion.',
      ),
    use_regex: z
      .boolean()
      .default(false)
      .describe('Treat search_pattern as a regular expression.'),
    ignore_leading_whitespace: z
      .boolean()
      .default(true)
      .describe(
        'Ignore leading whitespace on each line of search_pattern when matching plain text.',
      ),
    preserve_indentation: z
      .boolean()
      .default(true)
      .describe(
        'Attempt to automatically adjust the indentation of replace_content to match the context of the replaced/inserted block.',
      ),
    match_occurrence: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe(
        'Specifies which occurrence of the search_pattern (relative to start_line if provided, or globally otherwise) to target (1-based). Default is 1.',
      ),
  })
  .refine(
    (data) =>
      data.search_pattern !== undefined || data.replace_content !== undefined,
    {
      message:
        "Either 'search_pattern' or 'replace_content' must be provided for a change operation.",
    },
  );

const EditFileArgsSchema = z.object({
  changes: z
    .array(EditFileChangeSchema)
    .min(1)
    .describe('List of changes to apply across one or more files.'),
  dry_run: z
    .boolean()
    .default(false)
    .describe(
      'If true, perform matching and generate diffs but do not write any changes to disk.',
    ),
  output_diff: z
    .boolean()
    .default(true)
    .describe(
      'Whether to include a unified diff string in the result for each modified file.',
    ),
});

type EditFileArgs = z.infer<typeof EditFileArgsSchema>;

// --- Define Dependencies Interface ---
import type { FileHandle } from 'fs/promises'; // Import FileHandle

// --- Define Dependencies Interface ---
export interface EditFileDeps {
  writeFile: (
    path: PathLike | FileHandle, // Use PathLike | FileHandle
    data: string | NodeJS.ArrayBufferView,
    options?: WriteFileOptions | BufferEncoding | null, // Match fs.promises.writeFile options more closely
  ) => Promise<void>;
}

// --- Helper Functions ---

/** Handles errors occurring during the applyChangesToFile process. */
function handleApplyChangesError(
  errorMessage: string, // Accept pre-processed message
  relativePath: string,
  fileResult: EditFileResultItem, // Modify the result object directly
): void {
  // Log the processed error message
  console.error(
    // Prettier fix applied
    `[editFile] Error processing ${relativePath}: ${errorMessage}`,
  );
  if (fileResult.status !== 'failed') {
    // Avoid overwriting previous specific errors
    fileResult.status = 'failed';
    fileResult.message = errorMessage; // Assign the message directly
  }
}

// --- NEW HELPER FUNCTION for Finalization ---
// --- HELPER for _finalizeAndWriteChanges: Generate Diff ---
function _generateDiff(
  relative: string,
  original: string,
  current: string,
): string {
  try {
    return createPatch(
      relative,
      original,
      current,
      '', // oldHeader
      '', // newHeader
      { context: 3 },
    );
  } catch (diffError: unknown) {
    console.warn(
      `[editFile] Failed to generate diff for ${relative}: ${
        diffError instanceof Error ? diffError.message : String(diffError)
      }`,
    );
    return 'Error generating diff.';
  }
}

// --- HELPER for _finalizeAndWriteChanges: Write File ---
async function _writeFile(
  absolute: string,
  current: string,
  deps: EditFileDeps, // Added deps
  fileResult: EditFileResultItem, // Modifies fileResult
): Promise<void> {
  try {
    await deps.writeFile(absolute, current, 'utf-8'); // Use deps.writeFile
  } catch (writeError: unknown) {
    console.error(`[editFile] Failed to write file ${absolute}:`, writeError);
    fileResult.status = 'failed';
    fileResult.message = `Failed to write changes: ${
      writeError instanceof Error ? writeError.message : String(writeError)
    }`;
    fileResult.diff = undefined; // Clear diff on write failure
  }
}

// --- REFACTORED Finalization Logic ---
async function _finalizeAndWriteChanges(
  state: FinalizeState,
  paths: FinalizePaths,
  options: FinalizeOptions,
  fileResult: EditFileResultItem, // Modifies fileResult directly
  deps: EditFileDeps, // Added deps
): Promise<void> {
  const { original, current, applied } = state;
  const { relative, absolute } = paths;
  const { output_diff, dry_run } = options;

  if (fileResult.status === 'failed') {
    return; // Don't overwrite failed status
  }

  if (applied) {
    fileResult.status = 'success';
    fileResult.message = dry_run
      ? 'File changes calculated (dry run).'
      : 'File modified successfully.';

    if (output_diff && original !== null && current !== null) {
      fileResult.diff = _generateDiff(relative, original, current);
    }

    if (!dry_run && current !== null && absolute) {
      await _writeFile(absolute, current, deps, fileResult); // Pass deps
    }
  } else {
    fileResult.status = 'skipped';
    fileResult.message = 'No changes applied to the file.';
  }
}

// --- Main Processing Logic ---

/** Processes all changes for a single file. */
async function applyChangesToFile(
  relativePath: string,
  fileChanges: EditFileChange[],
  output_diff: boolean,
  dry_run: boolean,
  deps: EditFileDeps, // Added deps
): Promise<EditFileResultItem> {
  const fileResult: EditFileResultItem = {
    path: relativePath.replace(/\\/g, '/'), // Normalize path early
    status: 'skipped', // Default status
  };
  let absolutePath: string | undefined = undefined;
  let originalContent: string | null = null; // Keep as potentially null initially
  let currentContent: string | null = null;
  let changesAppliedToFile = false;

  try {
    // 1. Read File Content
    const fileData = await readFileContentForEdit(relativePath);
    absolutePath = fileData.absolutePath;
    originalContent = fileData.originalContent; // originalContent is now string

    // 2. Apply Changes (originalContent is guaranteed string here)
    const { finalContent, changesApplied } = applyAllChangesToContent(
      originalContent, // Pass directly
      fileChanges,
      relativePath,
    );
    currentContent = finalContent;
    changesAppliedToFile = changesApplied;

    // 3. Finalize (Write/Diff)
    // originalContent is string, currentContent is string
    const state: FinalizeState = {
      original: originalContent,
      current: currentContent,
      applied: changesAppliedToFile,
    };
    const paths: FinalizePaths = {
      relative: relativePath,
      absolute: absolutePath,
    };
    const options: FinalizeOptions = { output_diff, dry_run };
    // Call the extracted helper function
    await _finalizeAndWriteChanges(state, paths, options, fileResult, deps); // Pass deps
  } catch (error: unknown) {
    // Process error within the catch block to generate a safe message string
    let errorMessage: string;
    if (error instanceof McpError) {
      errorMessage = error.message;
    } else if (error && typeof error === 'object' && 'code' in error) {
      const codeValue = error.code;
      if (typeof codeValue === 'string') {
        errorMessage = `Filesystem error (${codeValue}) processing ${relativePath}.`;
      } else if (typeof codeValue === 'number') {
        errorMessage = `Filesystem error (${codeValue.toString()}) processing ${relativePath}.`;
      } else {
        errorMessage = `Filesystem error (unknown code type) processing ${relativePath}.`;
      }
    } else if (error instanceof Error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      errorMessage = `Unexpected error processing ${relativePath}: ${error.message}`;
    } else {
      errorMessage = `Unexpected error processing ${relativePath}: Unknown error occurred`;
    }
    // Now call the helper with the safe string message
    handleApplyChangesError(errorMessage, relativePath, fileResult);
  }
  return fileResult;
}

/** Main handler function */
// Export for testing
export async function handleEditFileInternal(
  rawArgs: unknown,
  deps: EditFileDeps, // Added deps
): Promise<McpToolResponse> {
  const validationResult = EditFileArgsSchema.safeParse(rawArgs);
  if (!validationResult.success) {
    const errorDetails = validationResult.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
    throw new McpError(
      ErrorCode.InvalidParams, // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      `Invalid arguments for editFile: ${errorDetails}`,
    );
  }
  const args: EditFileArgs = validationResult.data;
  const { changes, dry_run = false, output_diff = true } = args;

  // Group changes by file
  const changesByFile: Record<string, EditFileChange[]> = {};
  for (const change of changes) {
    (changesByFile[change.path] ??= []).push(change);
  }

  const results: EditFileResultItem[] = [];
  for (const [relativePath, fileChanges] of Object.entries(changesByFile)) {
    const result = await applyChangesToFile(
      relativePath,
      fileChanges,
      output_diff,
      dry_run,
      deps, // Pass deps
    );
    results.push(result);
  }

  // Sort results by original path order for predictability
  const originalPathOrder = changes
    .map((c) => c.path.replace(/\\/g, '/'))
    .filter((v, i, a) => a.indexOf(v) === i);
  results.sort((a, b) => {
    const indexA = originalPathOrder.indexOf(a.path);
    const indexB = originalPathOrder.indexOf(b.path);
    // Handle cases where a path in results might not be in original changes (shouldn't happen)
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  return {
    content: [{ type: 'text', text: JSON.stringify({ results }, null, 2) }],
  };
}

// --- Tool Definition Export ---

export const editFileDefinition: ToolDefinition = {
  name: 'edit_file',
  description:
    'Make selective edits to one or more files using advanced pattern matching and formatting options. Supports insertion, deletion, and replacement with indentation preservation and diff output. Recommended for modifying existing files, especially for complex changes or when precise control is needed.',
  schema: EditFileArgsSchema,
  // Production handler provides real dependencies
  handler: (args: unknown): Promise<McpToolResponse> => {
    const productionDeps: EditFileDeps = {
      writeFile: fs.writeFile,
    };
    return handleEditFileInternal(args, productionDeps);
  },
};
