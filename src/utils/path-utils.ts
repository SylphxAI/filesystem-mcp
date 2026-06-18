import path from 'node:path';
import { promises as fs } from 'node:fs';
import { McpError as OriginalMcpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const McpError = OriginalMcpError;

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../');

/**
 * Detects Windows-style absolute paths regardless of the host OS.
 *
 * Node's POSIX `path.isAbsolute()` returns `false` for drive-letter paths
 * (`C:\Windows`, `C:/Windows`) and UNC paths (`\\server\share`), which would
 * let a Windows-shaped absolute path slip through the relative-path guard when
 * the server runs on Linux/macOS. Matching them here keeps validation
 * platform-independent.
 */
function isWindowsAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

/**
 * Separator-aware containment check.
 *
 * `startsWith()` is unsafe for path containment because it confuses
 * "inside this directory" with "starts with the same characters".
 * For example, `/foo/bar-secret` starts with `/foo/bar` but is NOT
 * inside `/foo/bar`.
 *
 * Uses `path.relative()` to compute the relationship between paths.
 * A path is inside (or equal to) `root` iff the relative path is
 * empty, does not start with `..`, and is not absolute (which can
 * happen on Windows when paths are on different drives).
 */
export function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export async function resolvePath(relativePath: string, rootPath?: string): Promise<string> {
  // Validate input types
  if (typeof relativePath !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Path must be a string');
  }
  if (rootPath && typeof rootPath !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Root path must be a string');
  }

  // Validate path format. Reject absolute paths on every OS, not just the one
  // the server happens to run on: on POSIX runtimes `path.isAbsolute()` does
  // not recognise Windows drive-letter (`C:\…`, `C:/…`) or UNC (`\\host\share`)
  // paths, so check those explicitly to keep the security boundary identical
  // across platforms.
  if (path.isAbsolute(relativePath) || isWindowsAbsolute(relativePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Absolute paths are not allowed: ${relativePath}`);
  }

  const root = rootPath || PROJECT_ROOT;
  const absolutePath = path.resolve(root, relativePath);

  // Validate path traversal (initial check before symlink resolution).
  // Uses separator-aware containment so that sibling-prefix paths like
  // `../root-secret/file.txt` (which resolve outside `root` but share
  // its string prefix) are correctly rejected.
  if (!isPathInside(absolutePath, root)) {
    throw new McpError(ErrorCode.InvalidRequest, `Path traversal detected: ${relativePath}`);
  }

  // Resolve symlinks to get the real path
  let realPath: string;
  try {
    realPath = await fs.realpath(absolutePath);
  } catch {
    // If the path doesn't exist yet (e.g., for file creation), use the absolute path
    // but verify parent directories don't contain malicious symlinks
    const parentDir = path.dirname(absolutePath);
    try {
      const realParentPath = await fs.realpath(parentDir);
      // Verify the real parent path is still within root
      if (!isPathInside(realParentPath, root)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Path traversal via symlink detected: ${relativePath}`,
        );
      }
      // Return the absolute path for non-existent files if parent is safe
      realPath = absolutePath;
    } catch (parentError) {
      // Re-throw McpError from the inner check; otherwise fall through
      // (parent doesn't exist either — operation will fail later).
      if (parentError instanceof McpError) {
        throw parentError;
      }
      realPath = absolutePath;
    }
  }

  // Final security check: verify the real path is within the project root
  if (!isPathInside(realPath, root)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Path traversal via symlink detected: resolved path '${realPath}' is outside project root`,
    );
  }

  return realPath;
}

export { PROJECT_ROOT };
