// src/utils/editFileUtils.ts
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';

import { resolvePath } from './pathUtils.js'; // Adjusted path
// Import string utils
import { getIndentation, applyIndentation } from './stringUtils.js';
// Import edit file specific utils
import {
  findNthRegexMatch,
  calculateIndentForReplacement,
  buildReplacementText,
  findNthPlainTextMatch,
} from './editFileSpecificUtils.js';

// --- Moved Types/Interfaces ---
// ... (Types remain the same)
export interface EditFileChange {
  path: string;
  search_pattern?: string | undefined;
  start_line: number;
  replace_content?: string | undefined;
  use_regex?: boolean | undefined;
  ignore_leading_whitespace?: boolean | undefined;
  preserve_indentation?: boolean | undefined;
  match_occurrence?: number | undefined;
}

export interface EditFileResultItem {
  path: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
  diff?: string | undefined; // Allow undefined for exactOptionalPropertyTypes
}

export interface ApplyChangeResult {
  content: string;
  applied: boolean;
  error?: string;
}

export interface FinalizeState {
  original: string | null;
  current: string | null;
  applied: boolean;
}
export interface FinalizePaths {
  relative: string;
  absolute: string | undefined;
}
export interface FinalizeOptions {
  output_diff: boolean;
  dry_run: boolean;
}
// Interface for findNthPlainTextMatch parameters moved to editFileSpecificUtils.ts

// --- Moved Helper Functions ---

// Handles insertion logic
export function performInsertion(
  lines: string[],
  change: EditFileChange,
): ApplyChangeResult {
  const { start_line, replace_content, preserve_indentation = true } = change;
  if (replace_content === undefined) {
    return {
      content: lines.join('\n'),
      applied: false,
      error: 'replace_content is required for insertion.',
    };
  }

  const targetLineIndex = start_line - 1;
  if (targetLineIndex < 0) {
    return {
      content: lines.join('\n'),
      applied: false,
      error: `Invalid start_line ${String(start_line)}`,
    };
  }

  const effectiveInsertionLine = Math.min(targetLineIndex, lines.length);
  let indent = '';
  if (
    preserve_indentation &&
    effectiveInsertionLine > 0 &&
    effectiveInsertionLine <= lines.length
  ) {
    // Get indent from the line *before* the insertion point
    indent = getIndentation(lines[effectiveInsertionLine - 1]); // Use imported util
  }
  // Use imported util
  const replacementLines = applyIndentation(replace_content, indent);
  lines.splice(effectiveInsertionLine, 0, ...replacementLines);
  return { content: lines.join('\n'), applied: true };
}

// Handles regex search and replace/delete (Refactored)
export function performRegexReplace(
  currentContent: string,
  change: EditFileChange,
): ApplyChangeResult {
  const {
    search_pattern,
    replace_content,
    match_occurrence = 1,
    preserve_indentation = true,
  } = change;

  if (!search_pattern) {
    return {
      content: currentContent,
      applied: false,
      error: 'search_pattern required for regex replace.',
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(search_pattern, 'g');
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);

    return {
      content: currentContent,
      applied: false,
      error: `Invalid regex pattern "${search_pattern}": ${errorMessage}`,
    };
  }

  // Use imported util
  const matchResult = findNthRegexMatch(
    currentContent,
    regex,
    match_occurrence,
  );

  if (!matchResult) {
    return { content: currentContent, applied: false }; // Pattern not found
  }

  const { startIndex, endIndex } = matchResult;

  // Use imported util
  const indent = calculateIndentForReplacement(
    currentContent,
    startIndex,
    preserve_indentation,
  );

  // Use imported util
  const replacementText = buildReplacementText(replace_content, indent);

  const finalContent =
    currentContent.slice(0, startIndex) +
    replacementText +
    currentContent.slice(endIndex);

  return { content: finalContent, applied: true };
}

// Handles plain text search and replace/delete (Refactored)
export function performPlainTextReplace(
  lines: string[],
  change: EditFileChange,
): ApplyChangeResult {
  const {
    search_pattern,
    start_line,
    replace_content,
    ignore_leading_whitespace = true,
    preserve_indentation = true,
    match_occurrence = 1, // Use match_occurrence
  } = change;

  if (!search_pattern)
    return {
      content: lines.join('\n'),
      applied: false,
      error: 'search_pattern required for plain text replace.',
    };

  const searchLines = search_pattern.split('\n');
  const searchStartLineIndex = start_line - 1;

  // Use imported util
  const matchResult = findNthPlainTextMatch({
    lines,
    searchLines,
    startLineIndex: searchStartLineIndex,
    ignoreLeadingWhitespace: ignore_leading_whitespace,
    occurrence: match_occurrence,
  });

  if (!matchResult) {
    return { content: lines.join('\n'), applied: false }; // Pattern not found
  }

  const { startIndex: matchStartIndex, endIndex: matchEndIndex } = matchResult;

  let indent = '';
  if (preserve_indentation && matchStartIndex < lines.length) {
    // Use imported util
    indent = getIndentation(lines[matchStartIndex]);
  }

  // Apply changes directly to lines array
  if (replace_content !== undefined) {
    // Use imported util
    const replacementText = buildReplacementText(replace_content, indent);
    const replacementLines = replacementText.split('\n'); // Split the result back into lines
    lines.splice(
      matchStartIndex,
      matchEndIndex - matchStartIndex,
      ...replacementLines,
    );
  } else {
    // Deletion case
    lines.splice(matchStartIndex, matchEndIndex - matchStartIndex);
  }

  return { content: lines.join('\n'), applied: true };
}

// Applies a single change operation
export function applySingleChange(
  currentContent: string,
  change: EditFileChange,
): ApplyChangeResult {
  const { search_pattern, use_regex = false, replace_content } = change;

  if (!search_pattern && replace_content !== undefined) {
    // Insertion
    const lines = currentContent.split('\n');
    return performInsertion(lines, change);
  } else if (search_pattern) {
    // Search/Replace/Delete
    if (use_regex) {
      return performRegexReplace(currentContent, change);
    } else {
      const lines = currentContent.split('\n');
      return performPlainTextReplace(lines, change);
    }
  } else {
    // Invalid change (should be caught by Zod refine, but handle defensively)
    return {
      content: currentContent,
      applied: false,
      error:
        'Invalid change operation: requires search_pattern or replace_content.',
    };
  }
}

// Helper to read file content and handle ENOENT specifically for editFile
export async function readFileContentForEdit(
  relativePath: string,
): Promise<{ absolutePath: string; originalContent: string }> {
  const absolutePath = resolvePath(relativePath);
  try {
    const originalContent = await fs.readFile(absolutePath, 'utf-8');
    return { absolutePath, originalContent };
  } catch (readError: unknown) {
    if (
      readError &&
      typeof readError === 'object' &&
      'code' in readError &&
      readError.code === 'ENOENT'
    ) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
      throw new McpError(
        ErrorCode.InvalidRequest, // eslint-disable-line @typescript-eslint/no-unsafe-member-access
        `File not found: ${relativePath}`,
      );
    }
    throw readError; // Re-throw other read errors
  }
}

// Applies all changes sequentially to the content string
export function applyAllChangesToContent(
  initialContent: string,
  fileChanges: EditFileChange[],
  relativePath: string, // For logging warnings
): { finalContent: string; changesApplied: boolean } {
  let currentContent = initialContent;
  let changesApplied = false;

  // Sort changes by start_line descending to minimize line number shifts
  fileChanges.sort((a, b) => b.start_line - a.start_line);

  for (const change of fileChanges) {
    const result = applySingleChange(currentContent, change);
    if (result.error) {
      // Log warning but continue processing other changes for the file
      console.warn(
        `[editFile] Skipping change for ${relativePath} due to error: ${result.error}`,
      );
    } else if (result.applied) {
      currentContent = result.content;
      changesApplied = true; // Mark that at least one change was applied
    }
  }
  return { finalContent: currentContent, changesApplied };
}
