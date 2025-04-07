// src/handlers/replaceContent.ts
import { promises as fs } from 'fs';
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath } from '../utils/pathUtils.js';

// --- Types ---

interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

export const ReplaceOperationSchema = z
  .object({
    search: z.string().describe('Text or regex pattern to search for.'),
    replace: z.string().describe('Text to replace matches with.'),
    use_regex: z
      .boolean()
      .optional()
      .default(false)
      .describe('Treat search as regex.'),
    ignore_case: z
      .boolean()
      .optional()
      .default(false)
      .describe('Ignore case during search.'),
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

interface ReplaceResult {
  file: string;
  replacements: number;
  modified: boolean;
  error?: string;
}

// --- Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): ReplaceContentArgs {
  try {
    return ReplaceContentArgsSchema.parse(args);
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

/** Applies a single replace operation to content. */
function applyReplaceOperation(
  currentContent: string,
  op: ReplaceOperation,
): { newContent: string; replacementsMade: number } {
  let replacementsInOp = 0;
  const searchPattern = op.search;
  const replacementText = op.replace;
  const useRegex = op.use_regex;
  const ignoreCase = op.ignore_case;

  let regexFlags = 'g'; // Always global replace within a file
  if (ignoreCase) regexFlags += 'i';
  // Add multiline flag if regex contains start/end anchors
  if (
    useRegex &&
    (searchPattern.includes('^') || searchPattern.includes('$'))
  ) {
    regexFlags += 'm';
  }

  let searchRegex: RegExp;
  try {
    searchRegex = useRegex
      ? new RegExp(searchPattern, regexFlags)
      : new RegExp(
          searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), // Escape special chars for literal search
          regexFlags,
        );
  } catch (e) {
    // If regex compilation fails even for literal search (unlikely but possible), treat as no match
    console.warn(
      `[Filesystem MCP - replaceContent] Regex compilation failed for literal search pattern "${searchPattern}":`,
      e,
    );
    return { newContent: currentContent, replacementsMade: 0 };
  }

  // Count matches before replacing
  const matches = currentContent.match(searchRegex);
  replacementsInOp = matches ? matches.length : 0;

  let newContent = currentContent;
  if (replacementsInOp > 0) {
    newContent = currentContent.replace(searchRegex, replacementText);
  }

  return { newContent, replacementsMade: replacementsInOp };
}

/** Handles errors during file processing for replacement. */
function handleReplaceError(
  error: unknown,
  relativePath: string,
): string | undefined {
  let errorMessage = `Failed to process file: ${error instanceof Error ? error.message : String(error)}`;
  let specificCode: string | null = null;

  if (error && typeof error === 'object' && 'code' in error) {
    specificCode = String(error.code);
    if (specificCode === 'ENOENT') {
      errorMessage = 'File not found';
    } else if (specificCode === 'EISDIR') {
      errorMessage = 'Path is not a file';
    } else if (specificCode === 'EACCES' || specificCode === 'EPERM') {
      errorMessage = `Permission denied processing file: ${relativePath}`;
    }
  } else if (error instanceof McpError) {
    errorMessage = error.message; // Use McpError message directly
  }

  console.error(
    `[Filesystem MCP - replaceContent] Error processing file ${relativePath}:`,
    error,
  );
  return errorMessage;
}

/** Processes replacements for a single file. */
async function processSingleFileReplacement(
  relativePath: string,
  operations: ReplaceOperation[],
): Promise<ReplaceResult> {
  const pathOutput = relativePath.replace(/\\/g, '/');
  let targetPath = '';
  let originalContent = '';
  let fileContent = '';
  let totalReplacements = 0;
  let modified = false;

  try {
    targetPath = resolvePath(relativePath);
    const stats = await fs.stat(targetPath);
    if (!stats.isFile()) {
      return {
        file: pathOutput,
        replacements: 0,
        modified: false,
        error: 'Path is not a file',
      };
    }

    originalContent = await fs.readFile(targetPath, 'utf-8');
    fileContent = originalContent;

    for (const op of operations) {
      const { newContent, replacementsMade } = applyReplaceOperation(
        fileContent,
        op,
      );
      if (replacementsMade > 0) {
        fileContent = newContent;
        totalReplacements += replacementsMade;
      }
    }

    if (fileContent !== originalContent) {
      modified = true;
      await fs.writeFile(targetPath, fileContent, 'utf-8');
    }

    return { file: pathOutput, replacements: totalReplacements, modified };
  } catch (error: unknown) {
    const fileError = handleReplaceError(error, relativePath);
    return {
      file: pathOutput,
      replacements: 0,
      modified: false,
      error: fileError,
    };
  }
}

/** Processes the results from Promise.allSettled for replace operations. */
function processSettledReplaceResults(
  settledResults: PromiseSettledResult<ReplaceResult>[],
  relativePaths: string[],
): ReplaceResult[] {
  const fileProcessingResults: ReplaceResult[] = [];
  settledResults.forEach((result, index) => {
    const relativePath = relativePaths[index] ?? 'unknown_path';
    const pathOutput = relativePath.replace(/\\/g, '/');
    if (result.status === 'fulfilled') {
      fileProcessingResults.push(result.value);
    } else {
      console.error(
        `[Filesystem MCP - replaceContent] Unexpected rejection processing file ${pathOutput}:`,
        result.reason,
      );
      fileProcessingResults.push({
        file: pathOutput,
        replacements: 0,
        modified: false,
        error: `Unexpected error during file processing: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      });
    }
  });
  return fileProcessingResults;
}

/** Processes all file replacements and handles results. */
async function processAllFilesReplacement(
  relativePaths: string[],
  operations: ReplaceOperation[],
): Promise<ReplaceResult[]> {
  let fileProcessingResults: ReplaceResult[] = [];
  try {
    const settledResults = await Promise.allSettled(
      relativePaths.map((relativePath) =>
        processSingleFileReplacement(relativePath, operations),
      ),
    );
    fileProcessingResults = processSettledReplaceResults(
      settledResults,
      relativePaths,
    );
  } catch (error: unknown) {
    // Catch errors during the overall process setup (less likely now)
    if (error instanceof McpError) throw error;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[Filesystem MCP - replaceContent] Error during replace_content execution setup:`,
      error,
    );
    throw new McpError(
      ErrorCode.InternalError,
      `Failed during replace_content setup: ${errorMessage}`,
    );
  }

  // Sort results by original path order for predictability
  const originalIndexMap = new Map(
    relativePaths.map((p, i) => [p.replace(/\\/g, '/'), i]),
  );
  fileProcessingResults.sort((a, b) => {
    const indexA = originalIndexMap.get(a.file) ?? Infinity;
    const indexB = originalIndexMap.get(b.file) ?? Infinity;
    return indexA - indexB;
  });

  return fileProcessingResults;
}

/** Main handler function */
const handleReplaceContentFunc = async (
  args: unknown,
): Promise<McpToolResponse> => {
  const { paths: relativePaths, operations } = parseAndValidateArgs(args);

  const finalResults = await processAllFilesReplacement(
    relativePaths,
    operations,
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            message: `Replace content operations completed on specified paths.`,
            results: finalResults,
          },
          null,
          2,
        ),
      },
    ],
  };
};

// Export the complete tool definition
export const replaceContentToolDefinition = {
  name: 'replace_content',
  description: 'Replace content within files across multiple specified paths.',
  schema: ReplaceContentArgsSchema,
  handler: handleReplaceContentFunc,
};
