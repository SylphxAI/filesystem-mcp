import { promises as fs, type PathLike } from 'fs'; // Import PathLike
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types'; // Use specific imports
import type { McpRequest, McpResponse } from '@modelcontextprotocol/sdk/types';
import type { ToolDefinition } from '@modelcontextprotocol/sdk/server';

import {
  applyDiffInputSchema,
  applyDiffOutputSchema,
  type ApplyDiffInput,
  type ApplyDiffOutput,
  type DiffApplyResult,
  type FileDiff,
} from '../schemas/applyDiffSchema';
import { resolvePath as resolvePathUtil } from '../utils/pathUtils'; // Rename default import
import { applyDiffsToFileContent } from '../utils/applyDiffUtils';

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

/**
 * Internal handler function for applying diffs, accepting dependencies.
 * Exported for testing purposes.
 */
// eslint-disable-next-line max-lines-per-function -- Main handler logic is complex
export async function handleApplyDiffInternal( // Added export keyword
  deps: ApplyDiffDeps,
  requestArgs: ApplyDiffInput,
): Promise<ApplyDiffOutput> {
  // Return data directly
  const { changes } = requestArgs;
  const results: DiffApplyResult[] = [];

  const settledResults = await Promise.allSettled(
    // eslint-disable-next-line max-lines-per-function, complexity -- Inner loop logic is complex
    changes.map(async (fileDiff: FileDiff): Promise<DiffApplyResult> => {
      let resolvedPath: string;
      try {
        // Use injected resolvePath and projectRoot
        resolvedPath = deps.resolvePath(fileDiff.path, deps.projectRoot);
      } catch (error) {
        console.error(`Path resolution failed for ${fileDiff.path}:`, error);
        const errorMessage =
          error instanceof McpError
            ? error.message
            : `Path resolution failed: ${String(error instanceof Error ? error.message : error)}`;
        return {
          path: fileDiff.path,
          success: false,
          error: errorMessage,
          context: `Project Root: ${deps.projectRoot}`,
        };
      }

      try {
        // Use injected readFile
        const originalContent = await deps.readFile(resolvedPath, 'utf-8');

        const diffResult = applyDiffsToFileContent(
          originalContent,
          fileDiff.diffs,
          fileDiff.path,
        );

        if (diffResult.success && diffResult.newContent !== undefined) {
          // Use injected writeFile
          await deps.writeFile(resolvedPath, diffResult.newContent, 'utf-8');
          return { path: fileDiff.path, success: true };
        } else {
          return {
            path: fileDiff.path,
            success: false,
            error: diffResult.error ?? 'Unknown diff application error',
            context: diffResult.context,
          };
        }
      } catch (error) {
        console.error(`Error processing file ${fileDiff.path}:`, error);
        let errorMessage = `Failed to process file: ${String(error instanceof Error ? error.message : error)}`;
        if (error instanceof Error && 'code' in error) {
          const nodeError = error as NodeJS.ErrnoException;
          if (nodeError.code === 'ENOENT') {
            errorMessage = `File not found at resolved path: ${resolvedPath}. Original path: ${fileDiff.path}. Project Root: ${deps.projectRoot}`;
          } else if (
            nodeError.code === 'EACCES' ||
            nodeError.code === 'EPERM'
          ) {
            errorMessage = `Permission denied for file: ${resolvedPath}. Original path: ${fileDiff.path}.`;
          }
        } else if (
          typeof error === 'object' &&
          error !== null &&
          'message' in error
        ) {
          errorMessage = `Failed to process file: ${String(error.message)}`;
        }
        return {
          path: fileDiff.path,
          success: false,
          error: errorMessage,
          context: `Resolved Path: ${resolvedPath}`,
        };
      }
    }),
  );

  settledResults.forEach((result) => {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      const reason = result.reason;
      console.error('Unexpected error during Promise.allSettled:', reason);
      let errorMsg = 'Unexpected processing error';
      if (reason instanceof Error) {
        errorMsg = `Unexpected processing error: ${reason.message}`;
      } else if (typeof reason === 'string') {
        errorMsg = `Unexpected processing error: ${reason}`;
      }
      results.push({
        path: 'Unknown Path',
        success: false,
        error: errorMsg,
      });
    }
  });

  return { results }; // Return the data structure directly
}

// Tool Definition using the internal handler
export const applyDiffTool: ToolDefinition<ApplyDiffInput, ApplyDiffOutput> = {
  name: 'apply_diff',
  description:
    'Applies multiple search/replace diff blocks to multiple files. Changes per file are atomic: if any block fails, the file remains unchanged. Provides detailed results per file.',
  inputSchema: applyDiffInputSchema,
  outputSchema: applyDiffOutputSchema,
  handler: async (
    request: McpRequest<ApplyDiffInput>,
  ): Promise<McpResponse<ApplyDiffOutput>> => {
    const productionDeps: ApplyDiffDeps = {
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      resolvePath: resolvePathUtil,
      projectRoot: process.cwd(), // Use actual cwd for production
    };
    try {
      // Ensure request.params.arguments is passed correctly
      const data = await handleApplyDiffInternal(
        productionDeps,
        request.params.arguments,
      );
      return { success: true, data };
    } catch (error) {
      // Catch errors from internal handler (e.g., validation) and wrap in McpResponse
      if (error instanceof McpError) {
        return { success: false, error };
      }
      console.error('[applyDiff] Unhandled internal error:', error);
      return {
        success: false,
        error: new McpError(
          ErrorCode.InternalError,
          `Internal server error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      };
    }
  },
};
