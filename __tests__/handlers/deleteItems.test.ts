import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
// import type * as fs from 'fs'; // Removed unused import
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  createTemporaryFilesystem,
  cleanupTemporaryFilesystem,
} from '../testUtils.js';

// Mock pathUtils BEFORE importing the handler
vi.mock('../../src/utils/pathUtils.js'); // Mock the entire module

// Import the handler and the internal function for mocking
import {
  deleteItemsToolDefinition,
  processSettledResults, // Import the function to test directly
} from '../../src/handlers/deleteItems.js';
// Import the mocked functions/constants we need to interact with
// Note: We import resolvePath here to use vi.mocked(resolvePath) later
import { resolvePath, PROJECT_ROOT } from '../../src/utils/pathUtils.js';

// Define the initial structure for the temporary filesystem
const initialTestStructure = {
  'fileToDelete1.txt': 'content1',
  dirToDelete: {
    'nestedFile.txt': 'content2',
    emptySubDir: {},
  },
  'fileToKeep.txt': 'keep me',
  dirToKeep: {
    'anotherFile.js': 'keep this too',
  },
  emptyDirToDelete: {},
};

let tempRootDir: string;

// Define a simplified type for the result expected by processSettledResults for testing
interface DeleteResultForTest {
  path: string;
  success: boolean;
  note?: string;
  error?: string;
}

describe('handleDeleteItems Integration Tests', () => {
  // No top-level spy declarations needed anymore

  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(initialTestStructure);

    // Configure the mock resolvePath (remains the same)
    // Set the default implementation for the mocked resolvePath in beforeEach
    vi.mocked(resolvePath).mockImplementation(
      (relativePath: string): string => {
        // Use MOCK_PROJECT_ROOT defined within the mock factory if needed,
        // but here we use tempRootDir for dynamic paths based on test setup.
        if (path.isAbsolute(relativePath)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Mocked Absolute paths are not allowed for ${relativePath}`,
          );
        }
        const absolutePath = path.resolve(tempRootDir, relativePath);
        if (!absolutePath.startsWith(tempRootDir)) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Mocked Path traversal detected for ${relativePath}`,
          );
        }
        // For delete, we might want to check existence in the mock to simulate ENOENT before rm is called,
        // although the handler's rm call will also throw ENOENT. Let's keep it simple for now.
        return absolutePath;
      },
    );
    // Set the default implementation for the mocked PROJECT_ROOT
    // Note: Since PROJECT_ROOT is a const, we can't directly mock its value easily
    // after the module is loaded. The vi.mock factory is the primary way.
    // We'll rely on the value set in the vi.mock factory ('mocked/project/root').
    // If tests need to assert against it, they should use that mocked value.
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    // vi.clearAllMocks(); // clearAllMocks might interfere with module-level mocks like pathUtils
    vi.restoreAllMocks(); // Restore all spies after each test
  });

  it('should delete existing files and directories recursively', async () => {
    const request = {
      paths: ['fileToDelete1.txt', 'dirToDelete', 'emptyDirToDelete'],
    };
    const rawResult = await deleteItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text); // Assuming similar return structure

    expect(result).toHaveLength(3);
    expect(result.every((r: any) => r.success === true)).toBe(true); // Check all succeeded

    // Verify deletion
    await expect(
      fsPromises.access(path.join(tempRootDir, 'fileToDelete1.txt')),
    ).rejects.toThrow(/ENOENT/);
    await expect(
      fsPromises.access(path.join(tempRootDir, 'dirToDelete')),
    ).rejects.toThrow(/ENOENT/);
    await expect(
      fsPromises.access(path.join(tempRootDir, 'emptyDirToDelete')),
    ).rejects.toThrow(/ENOENT/);

    // Verify other files/dirs were kept
    await expect(
      fsPromises.access(path.join(tempRootDir, 'fileToKeep.txt')),
    ).resolves.toBeUndefined();
    await expect(
      fsPromises.access(path.join(tempRootDir, 'dirToKeep')),
    ).resolves.toBeUndefined();
  });

  it('should return errors for non-existent paths', async () => {
    const request = {
      paths: ['nonexistentFile.txt', 'nonexistentDir/'],
    };
    const rawResult = await deleteItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(2);
    // Handler treats ENOENT as success with a note
    expect(result[0].success).toBe(true);
    expect(result[0].note).toMatch(/Path not found/);
    expect(result[0].error).toBeUndefined();
    expect(result[1].success).toBe(true);
    expect(result[1].note).toMatch(/Path not found/);
    expect(result[1].error).toBeUndefined();
  });

  it('should handle mixed success and failure cases', async () => {
    const request = {
      paths: [
        'fileToDelete1.txt', // success
        'nonexistent.txt', // success (ENOENT)
        '../outside.txt', // failure (traversal mock)
      ],
    };
    const rawResult = await deleteItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(3);

    const success = result.find((r: any) => r.path === 'fileToDelete1.txt');
    expect(success).toBeDefined();
    expect(success.success).toBe(true);
    expect(success.error).toBeUndefined();

    const nonexistent = result.find((r: any) => r.path === 'nonexistent.txt');
    expect(nonexistent).toBeDefined();
    // Handler treats ENOENT as success with a note
    expect(nonexistent.success).toBe(true);
    expect(nonexistent.note).toMatch(/Path not found/);
    expect(nonexistent.error).toBeUndefined();

    const traversal = result.find((r: any) => r.path === '../outside.txt');
    expect(traversal).toBeDefined();
    expect(traversal.success).toBe(false);
    expect(traversal.error).toMatch(/Mocked Path traversal detected/);

    // Verify the successful delete occurred
    await expect(
      fsPromises.access(path.join(tempRootDir, 'fileToDelete1.txt')),
    ).rejects.toThrow(/ENOENT/);
    // Verify other files were kept
    await expect(
      fsPromises.access(path.join(tempRootDir, 'fileToKeep.txt')),
    ).resolves.toBeUndefined();
  });

  it('should return error for absolute paths (caught by mock resolvePath)', async () => {
    const absolutePath = path.resolve(tempRootDir, 'fileToDelete1.txt');
    const request = { paths: [absolutePath] };
    const rawResult = await deleteItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should reject requests with empty paths array based on Zod schema', async () => {
    const request = { paths: [] };
    await expect(deleteItemsToolDefinition.handler(request)).rejects.toThrow(
      McpError,
    );
    await expect(deleteItemsToolDefinition.handler(request)).rejects.toThrow(
      /Paths array cannot be empty/,
    );
  });

  // Add test for deleting the root directory itself (should be prevented)
  it('should prevent deleting the project root directory', async () => {
    // Temporarily override the mock for this specific test case
    vi.mocked(resolvePath).mockImplementationOnce(
      (relativePath: string): string => {
        if (relativePath === '.') {
          // Return the value the handler expects for PROJECT_ROOT from the mocked module
          return vi.mocked(PROJECT_ROOT);
        }
        // Default behavior for other paths
        if (path.isAbsolute(relativePath)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Mocked Absolute paths are not allowed for ${relativePath}`,
          );
        }
        const absolutePath = path.resolve(tempRootDir, relativePath);
        if (!absolutePath.startsWith(tempRootDir)) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Mocked Path traversal detected for ${relativePath}`,
          );
        }
        return absolutePath;
      },
    );

    const request = { paths: ['.'] }; // Attempt to delete '.'
    const rawResult = await deleteItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toBeDefined();
    expect(result[0].error).toMatch(/Deleting the project root is not allowed/);

    // Verify root directory still exists
    await expect(fsPromises.access(tempRootDir)).resolves.toBeUndefined();
  });

  it('should handle permission errors during delete', async () => {
    const targetFile = 'permission_error.txt';
    // Mock resolvePath to simulate a permission error scenario indirectly
    // by having it throw an error that handleDeleteError will interpret
    const permissionError = new Error('Mocked EACCES error');
    (permissionError as NodeJS.ErrnoException).code = 'EACCES';
    vi.mocked(resolvePath).mockImplementationOnce(
      (relativePath: string): string => {
        if (relativePath === targetFile) {
          throw permissionError;
        }
        // Default behavior
        const absolutePath = path.resolve(tempRootDir, relativePath);
        if (!absolutePath.startsWith(tempRootDir)) {
          throw new McpError(ErrorCode.InvalidRequest, 'Traversal');
        }
        return absolutePath;
      },
    );

    const request = { paths: [targetFile] };
    const rawResult = await deleteItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Permission denied deleting/); // Check specific message from getErrorInfo
  });

  it('should handle generic errors during delete', async () => {
    const targetFile = 'generic_error.txt';
    const genericError = new Error('Mocked generic delete error');
    // Mock resolvePath to throw a generic error
    vi.mocked(resolvePath).mockImplementationOnce(
      (relativePath: string): string => {
        if (relativePath === targetFile) {
          throw genericError;
        }
        // Default behavior
        const absolutePath = path.resolve(tempRootDir, relativePath);
        if (!absolutePath.startsWith(tempRootDir)) {
          throw new McpError(ErrorCode.InvalidRequest, 'Traversal');
        }
        return absolutePath;
      },
    );

    const request = { paths: [targetFile] };
    const rawResult = await deleteItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(
      /Failed to delete: Mocked generic delete error/,
    ); // Check specific message from getErrorInfo
  });

  // Test case for processSettledResults directly
  it('should correctly process settled results including rejections', () => {
    const originalPaths = ['path/success', 'path/failed'];
    const mockReason = new Error('Mocked rejection reason');
    // Use the simplified local type for testing
    const settledResults: PromiseSettledResult<DeleteResultForTest>[] = [
      {
        status: 'fulfilled',
        value: {
          path: 'path/success',
          success: true,
        },
      },
      { status: 'rejected', reason: mockReason },
    ];

    // Call the exported function directly
    const processed = processSettledResults(settledResults, originalPaths);

    expect(processed).toHaveLength(2);
    expect(processed[0]).toEqual({
      path: 'path/success',
      success: true,
    });
    expect(processed[1]).toEqual({
      path: 'path/failed',
      success: false,
      error: `Unexpected error during processing: ${mockReason.message}`,
      // resolvedPath is not part of DeleteResultForTest, so it's undefined here
    });
  });

  it('should throw McpError for invalid top-level arguments (e.g., paths not an array)', async () => {
    const invalidRequest = { paths: 'not-an-array' }; // Invalid structure
    await expect(
      deleteItemsToolDefinition.handler(invalidRequest),
    ).rejects.toThrow(McpError);
    await expect(
      deleteItemsToolDefinition.handler(invalidRequest),
    ).rejects.toThrow(/Invalid arguments: paths/); // Check Zod error message
  });
});
