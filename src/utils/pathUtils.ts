import path from "path";
import { fileURLToPath } from 'url';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Calculate PROJECT_ROOT relative to the build output directory
const __filename = fileURLToPath(import.meta.url);
// Assuming this util file will be in build/utils/, __dirname is build/utils/
// Go up two levels to reach the intended project root (filesystem/)
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

console.log(`[Filesystem MCP - pathUtils] Project Root determined as: ${PROJECT_ROOT}`);

/**
 * Resolves a user-provided relative path against the project root,
 * ensuring it stays within the project boundaries.
 * Throws McpError on invalid input, absolute paths, or path traversal.
 * @param userPath The relative path provided by the user.
 * @returns The resolved absolute path.
 */
export const resolvePath = (userPath: string): string => {
  if (typeof userPath !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Path must be a string.');
  }
  const normalizedUserPath = path.normalize(userPath);
  if (path.isAbsolute(normalizedUserPath)) {
      throw new McpError(ErrorCode.InvalidParams, 'Absolute paths are not allowed.');
  }
  // Resolve against the calculated PROJECT_ROOT
  const resolved = path.resolve(PROJECT_ROOT, normalizedUserPath);
  // Security check: Ensure the resolved path is still within the project root
  if (!resolved.startsWith(PROJECT_ROOT)) {
      throw new McpError(ErrorCode.InvalidRequest, 'Path traversal detected. Access denied.');
  }
  return resolved;
};