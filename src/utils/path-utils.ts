import path from 'node:path';
import { promises as fs } from 'node:fs';
import { McpError as OriginalMcpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const McpError = OriginalMcpError;

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../');

export async function resolvePath(relativePath: string, rootPath?: string): Promise<string> {
  // Validate input types
  if (typeof relativePath !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Path must be a string');
  }
  if (rootPath && typeof rootPath !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Root path must be a string');
  }

  // Validate path format
  if (path.isAbsolute(relativePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Absolute paths are not allowed: ${relativePath}`);
  }

  const root = rootPath || PROJECT_ROOT;
  const absolutePath = path.resolve(root, relativePath);

  // Validate path traversal (initial check before symlink resolution)
  if (!absolutePath.startsWith(root)) {
    throw new McpError(ErrorCode.InvalidRequest, `Path traversal detected: ${relativePath}`);
  }

  // Resolve symlinks to get the real path
  let realPath: string;
  try {
    realPath = await fs.realpath(absolutePath);
  } catch (error) {
    // If the path doesn't exist yet (e.g., for file creation), use the absolute path
    // but verify parent directories don't contain malicious symlinks
    const parentDir = path.dirname(absolutePath);
    try {
      const realParentPath = await fs.realpath(parentDir);
      // Verify the real parent path is still within root
      if (!realParentPath.startsWith(root)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Path traversal via symlink detected: ${relativePath}`,
        );
      }
      // Return the absolute path for non-existent files if parent is safe
      realPath = absolutePath;
    } catch {
      // Parent doesn't exist either, use absolute path
      // This will fail later during actual file operations if the path is invalid
      realPath = absolutePath;
    }
  }

  // Final security check: verify the real path is within the project root
  if (!realPath.startsWith(root)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Path traversal via symlink detected: resolved path '${realPath}' is outside project root`,
    );
  }

  return realPath;
}

export { PROJECT_ROOT };
