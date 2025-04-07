// src/utils/stringUtils.ts

/**
 * Gets the leading whitespace (indentation) of a line.
 * @param line The line to check.
 * @returns The leading whitespace, or an empty string if no line or no whitespace.
 */
export function getIndentation(line: string | undefined): string {
  if (!line) return '';
  const match = /^\s*/.exec(line);
  return match ? match[0] : '';
}

/**
 * Applies indentation to each line of a multi-line string.
 * @param content The content string.
 * @param indent The indentation string to apply.
 * @returns An array of indented lines.
 */
export function applyIndentation(content: string, indent: string): string[] {
  return content.split('\n').map((line) => indent + line);
}

/**
 * Checks if two lines match, optionally ignoring leading whitespace on the file line.
 * @param fileLine The line from the file content.
 * @param searchLine The line from the search pattern.
 * @param ignoreLeadingWhitespace Whether to ignore leading whitespace on the file line.
 * @returns True if the lines match according to the rules.
 */
export function linesMatch(
  fileLine: string | undefined,
  searchLine: string | undefined,
  ignoreLeadingWhitespace: boolean,
): boolean {
  if (fileLine === undefined || searchLine === undefined) {
    return false;
  }
  const trimmedSearchLine = searchLine.trimStart();
  const effectiveFileLine =
    ignoreLeadingWhitespace && trimmedSearchLine.length > 0
      ? fileLine.trimStart()
      : fileLine;
  const effectiveSearchLine = ignoreLeadingWhitespace
    ? trimmedSearchLine
    : searchLine;
  return effectiveFileLine === effectiveSearchLine;
}
