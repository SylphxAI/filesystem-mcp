import path from 'node:path';
import { McpError as OriginalMcpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const McpError = OriginalMcpError;

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../');

export function resolvePath(relativePath: string, rootPath?: string): string {
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

  // Validate path traversal
  if (!absolutePath.startsWith(root)) {
    throw new McpError(ErrorCode.InvalidRequest, `Path traversal detected: ${relativePath}`);
  }

  return absolutePath;
}

export { PROJECT_ROOT };
