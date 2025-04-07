import path from 'path';
// import { fileURLToPath } from 'url'; // Removed unused import
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// Use the server's current working directory as the project root.
// This relies on the process launching the server to set the CWD correctly.
export const PROJECT_ROOT = process.cwd();
/**
 * Resolves a user-provided relative path against the project root,
 * ensuring it stays within the project boundaries.
 * Throws McpError on invalid input, absolute paths, or path traversal.
 * @param userPath The relative path provided by the user.
 * @returns The resolved absolute path.
 */
export const resolvePath = (
  userPath: string,
  projectRootOverride?: string, // Optional override for testing
): string => {
  if (typeof userPath !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Path must be a string.');
  }
  const normalizedUserPath = path.normalize(userPath);
  if (path.isAbsolute(normalizedUserPath)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Absolute paths are not allowed. Received: '${normalizedUserPath}'`,
    );
  }
  const effectiveProjectRoot = projectRootOverride ?? PROJECT_ROOT; // Use override or default
  // Resolve against the effective project root
  const resolved = path.resolve(effectiveProjectRoot, normalizedUserPath);
  // Security check: Ensure the resolved path is still within the effective project root
  if (!resolved.startsWith(effectiveProjectRoot)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Path traversal detected. Attempted path '${userPath}' resolved to '${resolved}' which is outside the project root '${effectiveProjectRoot}'. Access denied.`,
    );
  }
  return resolved;
};
