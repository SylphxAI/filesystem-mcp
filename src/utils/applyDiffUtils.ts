import type { DiffBlock } from '../schemas/applyDiffSchema.js';

// Interface matching the Zod schema (error/context are optional)
interface ApplyDiffResult {
  success: boolean;
  newContent?: string;
  error?: string;
  context?: string;
}

/**
 * Helper function to get context lines around a specific line number.
 */
function getContextAroundLine(
  lines: readonly string[],
  lineNumber: number,
  contextSize = 3,
): string {
  // Ensure lineNumber is a valid positive integer
  if (
    typeof lineNumber !== 'number' ||
    !Number.isInteger(lineNumber) ||
    lineNumber < 1
  ) {
    console.error(
      `Invalid lineNumber provided to getContextAroundLine: ${String(lineNumber)}`,
    );
    return 'Error: Invalid line number provided for context.';
  }
  const start = Math.max(0, lineNumber - 1 - contextSize);
  const end = Math.min(lines.length, lineNumber + contextSize);
  const contextLines: string[] = [];

  for (let i = start; i < end; i++) {
    const currentLineNumber = i + 1;
    const prefix =
      currentLineNumber === lineNumber
        ? `> ${String(currentLineNumber)}`
        : `  ${String(currentLineNumber)}`;
    // Ensure lines[i] exists before accessing
    contextLines.push(`${prefix} | ${lines[i] ?? ''}`);
  }

  if (start > 0) {
    contextLines.unshift('  ...');
  }
  if (end < lines.length) {
    contextLines.push('  ...');
  }

  return contextLines.join('\n');
}

/**
 * Validates a single diff block structure.
 */
// eslint-disable-next-line complexity -- Accepting complexity after splitting into helpers
function validateDiffBlock(diff: unknown): diff is DiffBlock {
  // Check basic structure and types first
  if (
    !diff ||
    typeof diff !== 'object' ||
    !('search' in diff) ||
    typeof diff.search !== 'string' ||
    !('replace' in diff) ||
    typeof diff.replace !== 'string' ||
    !('start_line' in diff) ||
    typeof diff.start_line !== 'number' ||
    !('end_line' in diff) ||
    typeof diff.end_line !== 'number'
  ) {
    // console.error(`Invalid diff block structure:`, diff); // Avoid logging potentially large diffs
    return false;
  }
  // Now check the line number logic (diff is narrowed to object with expected props)
  if (diff.end_line < diff.start_line) {
    // console.error(`Invalid line numbers: end_line (${String(diff.end_line)}) < start_line (${String(diff.start_line)})`);
    return false;
  }
  return true;
}

/**
 * Validates line numbers for a diff block against file lines.
 */

function validateLineNumbers(
  diff: DiffBlock, // Expect DiffBlock
  lines: readonly string[],
): { isValid: boolean; error?: string; context?: string } {
  // Properties accessed safely as diff is DiffBlock
  const { start_line, end_line } = diff;

  if (
    start_line < 1 ||
    start_line > lines.length ||
    end_line < start_line || // This check is technically redundant due to validateDiffBlock
    end_line > lines.length ||
    !Number.isInteger(start_line) ||
    !Number.isInteger(end_line)
  ) {
    const error = `Invalid line numbers [${String(start_line)}-${String(end_line)}] for file with ${String(lines.length)} lines.`;
    const contextLineNum =
      Number.isInteger(start_line) && start_line > 0 ? start_line : 1;
    const context = getContextAroundLine(lines, contextLineNum);
    return { isValid: false, error, context };
  }
  return { isValid: true };
}

/**
 * Verifies content match for a diff block.
 */
function verifyContentMatch(
  diff: DiffBlock, // Expect DiffBlock
  lines: readonly string[],
): { isMatch: boolean; error?: string; context?: string } {
  // Properties accessed safely as diff is DiffBlock
  const { search, start_line, end_line } = diff;

  // Ensure start/end lines are valid before slicing (already checked by validateLineNumbers, but good practice)
  if (start_line < 1 || end_line < start_line || end_line > lines.length) {
    return {
      isMatch: false,
      error: `Internal Error: Invalid line numbers [${String(start_line)}-${String(end_line)}] in verifyContentMatch.`,
    };
  }

  const actualBlockLines = lines.slice(start_line - 1, end_line);
  const actualBlock = actualBlockLines.join('\n');
  const normalizedSearch = search.replace(/\r\n/g, '\n'); // Use regex literal

  if (actualBlock !== normalizedSearch) {
    const error = `Content mismatch at lines ${String(start_line)}-${String(end_line)}.`;
    const contextLineNum =
      Number.isInteger(start_line) && start_line > 0 ? start_line : 1;
    const context = `--- EXPECTED ---\n${normalizedSearch}\n--- ACTUAL ---\n${actualBlock}\n--- CONTEXT ---\n${getContextAroundLine(lines, contextLineNum)}`;
    return { isMatch: false, error, context };
  }
  return { isMatch: true };
}

/**
 * Applies a single validated diff block to the lines array.
 */
function applySingleValidDiff(
  lines: string[], // Modifiable
  diff: DiffBlock, // Expect DiffBlock
): void {
  // Properties accessed safely as diff is DiffBlock
  const { replace, start_line, end_line } = diff;
  const replaceContent = replace; // Already validated as string
  const replaceLines: string[] = replaceContent
    .replace(/\r\n/g, '\n')
    .split('\n');

  // Ensure line numbers are valid integers before splicing
  const safeStartLine = Number.isInteger(start_line) ? start_line : 0;
  const safeEndLine = Number.isInteger(end_line) ? end_line : 0;
  const deleteCount = Math.max(0, safeEndLine - safeStartLine + 1);

  // Allow inserting at the very end (index lines.length)
  if (
    safeStartLine > 0 &&
    deleteCount >= 0 &&
    safeStartLine - 1 <= lines.length // Check start index validity
  ) {
    // Adjust index for splice (0-based)
    lines.splice(safeStartLine - 1, deleteCount, ...replaceLines);
  } else {
    console.error(
      `Invalid splice parameters in applySingleValidDiff: start=${String(safeStartLine)}, deleteCount=${String(deleteCount)}, lines=${String(lines.length)}`,
    );
    // Optionally throw an error here?
  }
}

/**
 * Applies a series of diff blocks to a file's content string.
 */
export function applyDiffsToFileContent(
  originalContent: string,
  diffs: unknown, // Accept unknown type for initial validation
  filePath: string,
): ApplyDiffResult {
  if (!Array.isArray(diffs)) {
    return { success: false, error: 'Invalid diffs input: not an array.' };
  }

  const lines = originalContent.split('\n');
  // Filter and ensure the result is typed correctly
  const validDiffs: DiffBlock[] = diffs.filter(validateDiffBlock); // Use the combined validator

  if (validDiffs.length !== diffs.length) {
    console.warn(`Filtered out invalid diff blocks for ${filePath}`);
    // Consider returning an error or partial success indicator?
  }

  // Sort valid diffs (already typed as DiffBlock[]) by start_line descending
  const sortedDiffs = [...validDiffs].sort((a, b) => {
    // Safe access as a and b are DiffBlock
    return b.start_line - a.start_line;
  });

  for (const diff of sortedDiffs) {
    // Ensure diff is treated as DiffBlock inside the loop
    const lineValidation = validateLineNumbers(diff, lines);
    if (!lineValidation.isValid) {
      // Return type matching ApplyDiffResult, ensure error/context are defined or omitted
      return {
        success: false,
        error: lineValidation.error ?? 'Line validation failed', // Provide default error string
        ...(lineValidation.context && { context: lineValidation.context }), // Conditionally add context
      };
    }

    const contentMatch = verifyContentMatch(diff, lines);
    if (!contentMatch.isMatch) {
      // Return type matching ApplyDiffResult, ensure error/context are defined or omitted
      return {
        success: false,
        error: contentMatch.error ?? 'Content match failed', // Provide default error string
        ...(contentMatch.context && { context: contentMatch.context }), // Conditionally add context
      };
    }

    // Apply the diff (modifies 'lines' in place)
    applySingleValidDiff(lines, diff);
  }

  // If all valid diffs applied successfully
  const finalContent = lines.join('\n');
  return { success: true, newContent: finalContent };
}
