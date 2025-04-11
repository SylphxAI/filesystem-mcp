export function formatFileProcessingError(
  error: unknown,
  resolvedPath: string,
  filePath: string,
  // Removed projectRoot parameter entirely
): string {
  if (typeof error !== 'object' || error === null) {
    return `Failed to process file ${filePath}: ${String(error)}`;
  }

  const err = error as { code?: string; message?: string };

  if (err.code === 'ENOENT') {
    return `File not found at resolved path: ${resolvedPath}`;
  }
  if (err.code === 'EACCES') {
    return `Permission denied for file: ${filePath}`;
  }

  return `Failed to process file ${filePath}: ${err.message ?? 'Unknown error'}`;
}
