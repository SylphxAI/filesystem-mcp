// src/utils/editFileSpecificUtils.ts
import { getIndentation, applyIndentation, linesMatch } from './string-utils.js';

// Interface for findNthPlainTextMatch parameters (Copied from editFileUtils)
interface FindNthPlainTextMatchParams {
  lines: string[];
  searchLines: string[];
  startLineIndex: number;
  ignoreLeadingWhitespace: boolean;
  occurrence: number;
}

// Finds the start and end index of the Nth regex match
export function findNthRegexMatch(
  content: string,
  regex: RegExp, // Pass the compiled regex
  occurrence: number,
): { startIndex: number; endIndex: number } | null {
  let occurrencesFound = 0;
  let match: RegExpExecArray | null;
  regex.lastIndex = 0; // Reset before searching

  while ((match = regex.exec(content)) !== null) {
    occurrencesFound++;
    if (occurrencesFound === occurrence) {
      return {
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      };
    }
    // Avoid infinite loop on zero-length matches
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }
  return undefined as unknown as { startIndex: number; endIndex: number } | null; // Match not found
}

// Calculates the indentation for replacement content
export function calculateIndentForReplacement(
  currentContent: string,
  startIndex: number,
  preserveIndentation: boolean,
): string {
  if (!preserveIndentation) {
    return '';
  }
  // Calculate indent based on the line where the match starts
  const contentUpToMatch = currentContent.slice(0, Math.max(0, startIndex));
  const linesUpToMatch = contentUpToMatch.split('\n');
  // Use imported util
  return getIndentation(linesUpToMatch.at(-1));
}

// Builds the replacement text, applying indentation if needed
export function buildReplacementText(replaceContent: string | undefined, indent: string): string {
  if (replaceContent === undefined) {
    return ''; // Deletion case
  }
  // Use imported util
  const replacementLines = applyIndentation(replaceContent, indent);
  return replacementLines.join('\n');
}

// Finds the start and end line index of the Nth plain text match
export function findNthPlainTextMatch(
  params: FindNthPlainTextMatchParams, // Use the interface
): { startIndex: number; endIndex: number } | null {
  const { lines, searchLines, startLineIndex, ignoreLeadingWhitespace, occurrence } = params; // Destructure from the params object
  let occurrencesFound = 0;
  const searchStartLine = Math.max(0, startLineIndex); // Ensure start index is not negative

  for (let i = searchStartLine; i <= lines.length - searchLines.length; i++) {
    let isMatch = true;
    for (const [j, searchLine] of searchLines.entries()) {
      const fileLine = lines[i + j];
      // Use imported util
      if (!linesMatch(fileLine, searchLine, ignoreLeadingWhitespace)) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) {
      occurrencesFound++;
      if (occurrencesFound === occurrence) {
        return { startIndex: i, endIndex: i + searchLines.length };
      }
    }
  }
  return undefined as unknown as { startIndex: number; endIndex: number } | null; // Match not found for the specified occurrence
}
