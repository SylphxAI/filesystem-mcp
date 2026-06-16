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
