import type { DiffBlock } from '../schemas/applyDiffSchema';

interface ApplyDiffResult {
  success: boolean;
  newContent?: string;
  error?: string;
  context?: string;
}

/**
 * Helper function to get context lines around a specific line number.
 * Moved before its usage to fix no-use-before-define.
 * @param lines Array of file lines.
 * @param lineNumber The 1-based line number around which to get context.
 * @param contextSize Number of lines before and after to include.
 * @returns A string containing the context lines with line numbers.
 */
function getContextAroundLine(
  lines: string[],
  lineNumber: number,
  contextSize = 3,
): string {
  const start = Math.max(0, lineNumber - 1 - contextSize);
  const end = Math.min(lines.length, lineNumber + contextSize);
  const contextLines: string[] = [];

  for (let i = start; i < end; i++) {
    const currentLineNumber = i + 1;
    const prefix =
      currentLineNumber === lineNumber
        ? `> ${currentLineNumber}`
        : `  ${currentLineNumber}`;
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
 * Applies a series of diff blocks to a file's content string.
 * Ensures atomicity: if any block fails, returns original content implicitly (by returning success: false).
 * Provides context around the failure point.
 *
 * @param originalContent The original content of the file as a string.
 * @param diffs An array of diff blocks to apply, sorted bottom-up by the caller if necessary.
 * @param filePath The path of the file, used for error reporting.
 * @returns An object indicating success or failure, with new content or error details.
 */
export function applyDiffsToFileContent(
  originalContent: string,
  diffs: DiffBlock[],
  filePath: string,
): ApplyDiffResult {
  const lines = originalContent.split('\n');

  // Sort diffs by start_line descending to apply changes from bottom to top
  const sortedDiffs = [...diffs].sort((a, b) => b.start_line - a.start_line);

  for (const diff of sortedDiffs) {
    const { search, replace, start_line, end_line } = diff;

    // Validate line numbers against current lines array length
    if (
      start_line < 1 ||
      start_line > lines.length ||
      end_line < start_line ||
      end_line > lines.length
    ) {
      const error = `Invalid line numbers [${String(start_line)}-${String(end_line)}] for file with ${lines.length} lines.`;
      // Pass start_line (a number) directly to getContextAroundLine
      const context = getContextAroundLine(lines, start_line);
      console.error(`[${filePath}] ${error}`);
      return { success: false, error, context };
    }

    // Extract the block to be replaced based on line numbers (0-based index)
    const actualBlockLines = lines.slice(start_line - 1, end_line);
    const actualBlock = actualBlockLines.join('\n');

    // Normalize search block newlines for comparison using regex literal
    const normalizedSearch = search.replace(/\r\n/g, '\n');

    // Verify that the content at the specified lines matches the search block
    if (actualBlock !== normalizedSearch) {
      const error = `Content mismatch at lines ${String(start_line)}-${String(end_line)}. Expected block does not match actual file content.`;
      // Pass start_line (a number) directly to getContextAroundLine
      const context = `--- EXPECTED (Search Block) ---\n${normalizedSearch}\n--- ACTUAL (Lines ${String(start_line)}-${String(end_line)}) ---\n${actualBlock}\n--- SURROUNDING CONTEXT --- \n${getContextAroundLine(lines, start_line)}`;
      console.error(`[${filePath}] ${error}`);
      return { success: false, error, context };
    }

    // Perform the replacement
    // Ensure replace is treated as a string before splitting
    const replaceContent = String(replace ?? ''); // Ensure replace is a string
    const replaceLines: string[] = replaceContent
      .replace(/\r\n/g, '\n')
      .split('\n');
    // Spread the string array
    lines.splice(start_line - 1, end_line - start_line + 1, ...replaceLines);
  }

  // If all diffs applied successfully, join the lines back into the final content
  const finalContent = lines.join('\n');
  return { success: true, newContent: finalContent };
}
