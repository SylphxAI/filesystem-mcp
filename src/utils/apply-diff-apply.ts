import type { DiffBlock } from '../schemas/apply-diff-schema.js';
import type { DiffResult } from '../schemas/apply-diff-schema.js';
import {
  validateDiffBlock,
  validateLineNumbers,
  verifyContentMatch,
} from './apply-diff-validation.js';

// Interface matching the Zod schema (error/context are optional)
interface ApplyDiffResult {
  success: boolean;
  newContent?: string | undefined;
  error?: string;
  context?: string;
  diffResults?: DiffResult[];
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
