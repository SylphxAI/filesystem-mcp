import type { DiffBlock } from '../schemas/apply-diff-schema.js';
import { getContextAroundLine } from './apply-diff-context.js';

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
