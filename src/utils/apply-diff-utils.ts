import type { DiffBlock } from '../schemas/apply-diff-schema.js';
import type { DiffResult } from '../schemas/apply-diff-schema.js';

// Interface matching the Zod schema (error/context are optional)
interface ApplyDiffResult {
  success: boolean;
  newContent?: string | undefined;
  error?: string;
  context?: string;
  diffResults?: DiffResult[];
}

/**
 * Helper function to get context lines around a specific line number.
 */
export function getContextAroundLine(
  lines: readonly string[],
  lineNumber: number,
  contextSize = 3,
): string {
  // Ensure lineNumber is a valid positive integer
  if (typeof lineNumber !== 'number' || !Number.isInteger(lineNumber) || lineNumber < 1) {
    return `Error: Invalid line number (${String(lineNumber)}) provided for context.`;
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
 * Validates the basic structure and types of a potential diff block.
 */
export function hasValidDiffBlockStructure(diff: unknown): diff is {
  search: string;
  replace: string;
  start_line: number;
  end_line: number;
} {
  return (
    !!diff &&
    typeof diff === 'object' &&
    'search' in diff &&
    typeof diff.search === 'string' &&
    'replace' in diff &&
    typeof diff.replace === 'string' &&
    'start_line' in diff &&
    typeof diff.start_line === 'number' &&
    'end_line' in diff &&
    typeof diff.end_line === 'number'
  );
}

/**
 * Validates the line number logic within a diff block.
 */

function validateNonInsertLineNumbers(diff: DiffBlock, operation: string): boolean {
  const isValidLineNumbers =
    operation === 'insert'
      ? diff.end_line === diff.start_line - 1
      : diff.end_line >= diff.start_line;

  return (
    isValidLineNumbers &&
    diff.start_line > 0 &&
    diff.end_line > 0 &&
    Number.isInteger(diff.start_line) &&
    Number.isInteger(diff.end_line) &&
    diff.end_line <= Number.MAX_SAFE_INTEGER
  );
}

export function hasValidLineNumberLogic(start_line: number, end_line: number): boolean {
  // First check basic line number validity
  if (start_line <= 0 || !Number.isInteger(start_line) || !Number.isInteger(end_line)) {
    return false;
  }

  // Explicitly reject all cases where end_line < start_line
  if (end_line < start_line) {
    return false;
  }

  // Validate regular operations
  return validateNonInsertLineNumbers({ start_line, end_line } as DiffBlock, 'replace');
}

/**
 * Validates a single diff block structure and line logic.
 */
export function validateDiffBlock(diff: unknown): diff is DiffBlock {
  if (!hasValidDiffBlockStructure(diff)) {
    return false;
  }
  // Now diff is narrowed to the correct structure
  if (!hasValidLineNumberLogic(diff.start_line, diff.end_line)) {
    return false;
  }
  // Additional validation for insert operations
  if (diff.end_line === diff.start_line - 1 && diff.search !== '') {
    return false;
  }
  // If all validations pass, it conforms to DiffBlock
  return true;
}

/**
 * Validates line numbers for a diff block against file lines.
 */
export function validateLineNumbers(
  diff: DiffBlock,
  lines: readonly string[],
): { isValid: boolean; error?: string; context?: string } {
  // Properties accessed safely as diff is DiffBlock
  const { start_line, end_line } = diff;

  if (start_line < 1 || !Number.isInteger(start_line)) {
    const error = `Invalid line numbers [${String(start_line)}-${String(end_line)}]`;
    const context = [
      `File has ${String(lines.length)} lines total.`,
      getContextAroundLine(lines, 1),
    ].join('\n');
    return { isValid: false, error, context };
  }
  if (end_line < start_line || !Number.isInteger(end_line)) {
    const error = `Invalid line numbers [${String(start_line)}-${String(end_line)}]`;
    const context = [
      `File has ${String(lines.length)} lines total.`,
      getContextAroundLine(lines, start_line),
    ].join('\n');
    return { isValid: false, error, context };
  }
  if (end_line > lines.length) {
    const error = `Invalid line numbers [${String(start_line)}-${String(end_line)}]`;
    const contextLineNum = Math.min(start_line, lines.length);
    const context = [
      `File has ${String(lines.length)} lines total.`,
      getContextAroundLine(lines, contextLineNum),
    ].join('\n');
    return { isValid: false, error, context };
  }
  return { isValid: true };
}

/**
 * Verifies content match for a diff block.
 */
export function verifyContentMatch(
  diff: DiffBlock,
  lines: readonly string[],
): { isMatch: boolean; error?: string; context?: string } {
  // Properties accessed safely as diff is DiffBlock
  const { search, start_line, end_line } = diff;

  // Skip content verification for insert operations
  if (end_line === start_line - 1) {
    return { isMatch: true };
  }

  // Ensure start/end lines are valid before slicing (already checked by validateLineNumbers, but good practice)
  if (start_line < 1 || end_line < start_line || end_line > lines.length) {
    return {
      isMatch: false,
      error: `Internal Error: Invalid line numbers [${String(start_line)}-${String(end_line)}] in verifyContentMatch.`,
    };
  }

  const actualBlockLines = lines.slice(start_line - 1, end_line);
  const actualBlock = actualBlockLines.join('\n');
  // Normalize both search and actual content to handle all line ending types
  const normalizedSearch = search.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  const normalizedActual = actualBlock.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();

  if (normalizedActual !== normalizedSearch) {
    const error = `Content mismatch at lines ${String(start_line)}-${String(end_line)}. Expected content does not match actual content.`;
    const context = [
      `--- EXPECTED (Search Block) ---`,
      search,
      `--- ACTUAL (Lines ${String(start_line)}-${String(end_line)}) ---`,
      actualBlock,
      `--- DIFF ---`,
      `Expected length: ${String(search.length)}, Actual length: ${String(actualBlock.length)}`,
    ].join('\n');
    return { isMatch: false, error, context };
  }
  return { isMatch: true };
}

/**
 * Applies a single validated diff block to the lines array.
 */
export function applySingleValidDiff(lines: string[], diff: DiffBlock): void {
  const { replace, start_line, end_line } = diff;
  const replaceLines = replace.replaceAll('\r\n', '\n').split('\n');

  // Convert 1-based line numbers to 0-based array indices
  const startIdx = start_line - 1;

  // Handle insert operation (end_line = start_line - 1)
  if (end_line === start_line - 1) {
    // Validate insert position
    if (startIdx >= 0 && startIdx <= lines.length) {
      try {
        lines.splice(startIdx, 0, ...replaceLines);
      } catch {
        // Silently handle errors
      }
    }
    return;
  }

  // For normal operations:
  const endIdx = Math.min(lines.length, end_line);
  const deleteCount = endIdx - startIdx;

  // Validate operation bounds
  if (startIdx >= 0 && endIdx >= startIdx && startIdx < lines.length && endIdx <= lines.length) {
    try {
      lines.splice(startIdx, deleteCount, ...replaceLines);
    } catch {
      // Silently handle errors
    }
  }
}

/**
 * Applies a series of diff blocks to a file's content string.
 */
interface ValidationContext {
  diffResults: DiffResult[];
  errorMessages: string[];
}

function recordFailedDiff(
  validationContext: ValidationContext,
  diff: DiffBlock,
  error: string,
  context?: string,
): void {
  validationContext.diffResults.push({
    operation: diff.operation ?? 'replace',
    start_line: diff.start_line,
    end_line: diff.end_line,
    success: false,
    error,
    context,
  });
  validationContext.errorMessages.push(error);
}

function validateDiffContent(diff: DiffBlock, lines: string[], ctx: ValidationContext): boolean {
  if (diff.end_line === diff.start_line - 1) return true;

  const contentMatch = verifyContentMatch(diff, lines);
  if (contentMatch.isMatch) return true;

  recordFailedDiff(ctx, diff, contentMatch.error ?? 'Content match failed', contentMatch.context);
  return false;
}

function processDiffValidation(diff: DiffBlock, lines: string[], ctx: ValidationContext): boolean {
  const lineValidation = validateLineNumbers(diff, lines);
  if (!lineValidation.isValid) {
    recordFailedDiff(
      ctx,
      diff,
      lineValidation.error ?? 'Line validation failed',
      lineValidation.context,
    );
    return false;
  }

  if (diff.end_line === diff.start_line - 1 && diff.search !== '') {
    recordFailedDiff(
      ctx,
      diff,
      'Insert operations must have empty search string',
      `Invalid insert operation at line ${String(diff.start_line)}`,
    );
    return false;
  }

  return validateDiffContent(diff, lines, ctx);
}

function applyDiffAndRecordResult(
  diff: DiffBlock,
  lines: string[],
  ctx: ValidationContext,
): boolean {
  try {
    applySingleValidDiff(lines, diff);
    ctx.diffResults.push({
      operation: diff.operation ?? 'replace',
      start_line: diff.start_line,
      end_line: diff.end_line,
      success: true,
      context: `Successfully applied ${diff.operation ?? 'replace'} at lines ${String(diff.start_line)}-${String(diff.end_line)}`,
    });
    return true;
  } catch (error) {
    recordFailedDiff(
      ctx,
      diff,
      error instanceof Error ? error.message : String(error),
      `Failed to apply ${diff.operation ?? 'replace'} at lines ${String(diff.start_line)}-${String(diff.end_line)}`,
    );
    return false;
  }
}

export function applyDiffsToFileContent(originalContent: string, diffs: unknown): ApplyDiffResult {
  try {
    if (!Array.isArray(diffs)) {
      throw new TypeError('Invalid diffs input: not an array.');
    }

    const validDiffs = diffs.filter((diff) => validateDiffBlock(diff));
    if (validDiffs.length === 0) {
      return { success: true, newContent: originalContent };
    }

    const lines = originalContent.split('\n');
    const ctx: ValidationContext = {
      diffResults: [],
      errorMessages: [],
    };
    let hasErrors = false;

    for (const diff of [...validDiffs].sort((a, b) => b.end_line - a.end_line)) {
      if (!processDiffValidation(diff, lines, ctx)) {
        hasErrors = true;
        continue;
      }

      if (!applyDiffAndRecordResult(diff, lines, ctx)) {
        hasErrors = true;
      }
    }

    const result: ApplyDiffResult = {
      success: !hasErrors,
      newContent: hasErrors ? undefined : lines.join('\n'),
      diffResults: ctx.diffResults,
    };

    if (hasErrors) {
      result.error = `Some diffs failed: ${ctx.errorMessages.join('; ')}`;
      result.context = `Applied ${String(
        ctx.diffResults.filter((r) => r.success).length,
      )} of ${String(ctx.diffResults.length)} diffs successfully`;
    }

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
