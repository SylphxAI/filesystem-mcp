import type { Stats } from 'node:fs';

// Define and export the return type interface
export interface FormattedStats {
  // Add export keyword
  path: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  atime: string;
  mtime: string;
  ctime: string;
  birthtime: string;
  mode: string;
  uid: number;
  gid: number;
}

/**
 * Formats an fs.Stats object into a standardized structure for MCP responses.
 * @param relativePath The original relative path requested.
 * @param absolutePath The resolved absolute path of the item.
 * @param stats The fs.Stats object.
 * @returns A formatted stats object.
 */
export const formatStats = (
  relativePath: string,
  _absolutePath: string, // Unused parameter
  stats: Stats,
): FormattedStats => {
  // Add return type annotation
  // Ensure mode is represented as a 3-digit octal string
  const modeOctal = (stats.mode & 0o777).toString(8).padStart(3, '0');
  return {
    path: relativePath.replaceAll('\\', '/'), // Ensure forward slashes for consistency
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymbolicLink: stats.isSymbolicLink(),
    size: stats.size,
    atime: stats.atime.toISOString(),
    mtime: stats.mtime.toISOString(),
    ctime: stats.ctime.toISOString(),
    birthtime: stats.birthtime.toISOString(),
    mode: modeOctal,
    uid: stats.uid,
    gid: stats.gid,
  };
};
