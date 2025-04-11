import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'; // Added Mock type
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createTemporaryFilesystem, cleanupTemporaryFilesystem } from '../test-utils.js';

// Mock pathUtils BEFORE importing the handler
vi.mock('../../src/utils/path-utils.js'); // Mock the entire module

// Import the handler and the internal function for mocking
import {
  handleCreateDirectoriesInternal, // Import internal function
  CreateDirsDeps, // Import deps type
  processSettledResults, // Import the function to test directly
} from '../../src/handlers/create-directories.ts';
// Import the mocked functions/constants we need to interact with
// Removed unused PROJECT_ROOT import
import { resolvePath } from '../../src/utils/path-utils.js';

// Define the initial structure
const initialTestStructure = {
  existingDir: {},
  'existingFile.txt': 'hello',
};

let tempRootDir: string;

// Define a simplified type for the result expected by processSettledResults for testing
interface CreateDirResultForTest {
  path: string;
  success: boolean;
  note?: string;
  error?: string;
  resolvedPath?: string;
}

describe('handleCreateDirectories Integration Tests', () => {
  let mockDependencies: CreateDirsDeps;
  let mockMkdir: Mock;
  let mockStat: Mock;

  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(initialTestStructure);
    // Mock implementations for dependencies
    const actualFsPromises = await vi.importActual<typeof fsPromises>('fs/promises');
    mockMkdir = vi.fn().mockImplementation(actualFsPromises.mkdir);
    mockStat = vi.fn().mockImplementation(actualFsPromises.stat);

    // Configure the mock resolvePath
    vi.mocked(resolvePath).mockImplementation((relativePath: string): string => {
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
    });

    // Assign mock dependencies
    mockDependencies = {
      mkdir: mockMkdir,
      stat: mockStat,
      resolvePath: vi.mocked(resolvePath),
      PROJECT_ROOT: tempRootDir, // Use actual temp root for mock
    };
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    vi.restoreAllMocks();
  });

  it('should create a single new directory', async () => {
    const request = { paths: ['newDir1'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ path: 'newDir1', success: true }));
    const stats = await fsPromises.stat(path.join(tempRootDir, 'newDir1'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('should create multiple new directories', async () => {
    const request = { paths: ['multiDir1', 'multiDir2'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({ path: 'multiDir1', success: true }));
    expect(result[1]).toEqual(expect.objectContaining({ path: 'multiDir2', success: true }));
    const stats1 = await fsPromises.stat(path.join(tempRootDir, 'multiDir1'));
    expect(stats1.isDirectory()).toBe(true);
    const stats2 = await fsPromises.stat(path.join(tempRootDir, 'multiDir2'));
    expect(stats2.isDirectory()).toBe(true);
  });

  it('should create nested directories', async () => {
    const request = { paths: ['nested/dir/structure'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({ path: 'nested/dir/structure', success: true }),
    );
    const stats = await fsPromises.stat(path.join(tempRootDir, 'nested/dir/structure'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('should succeed if directory already exists', async () => {
    const request = { paths: ['existingDir'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ path: 'existingDir', success: true })); // Note: mkdir recursive succeeds silently if dir exists
    const stats = await fsPromises.stat(path.join(tempRootDir, 'existingDir'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('should return error if path is an existing file', async () => {
    const filePath = 'existingFile.txt';
    const request = { paths: [filePath] };
    // Mock mkdir to throw EEXIST first for this specific path
    mockMkdir.mockImplementation(async (p: string) => {
      if (p.endsWith(filePath)) {
        const error = new Error('File already exists') as NodeJS.ErrnoException;
        error.code = 'EEXIST';
        throw error;
      }
      const actualFsPromises = await vi.importActual<typeof fsPromises>('fs/promises');
      return actualFsPromises.mkdir(p, { recursive: true });
    });
    // Mock stat to return file stats for this path
    mockStat.mockImplementation(async (p: string) => {
      if (p.endsWith(filePath)) {
        const actualStat = await fsPromises.stat(path.join(tempRootDir, filePath));
        return { ...actualStat, isFile: () => true, isDirectory: () => false };
      }
      const actualFsPromises = await vi.importActual<typeof fsPromises>('fs/promises');
      return actualFsPromises.stat(p);
    });

    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Path exists but is not a directory/);
  });

  it('should handle mixed success and failure cases', async () => {
    const request = { paths: ['newGoodDir', 'existingDir', '../outsideDir'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(3);
    const successNew = result.find((r: CreateDirResultForTest) => r.path === 'newGoodDir');
    expect(successNew?.success).toBe(true);
    const successExisting = result.find((r: CreateDirResultForTest) => r.path === 'existingDir');
    expect(successExisting?.success).toBe(true);
    const traversal = result.find((r: CreateDirResultForTest) => r.path === '../outsideDir');
    expect(traversal?.success).toBe(false);
    expect(traversal?.error).toMatch(/Mocked Path traversal detected/);
    const statsNew = await fsPromises.stat(path.join(tempRootDir, 'newGoodDir'));
    expect(statsNew.isDirectory()).toBe(true);
  });

  it('should return error for absolute paths (caught by mock resolvePath)', async () => {
    const absolutePath = path.resolve(tempRootDir, 'newAbsoluteDir');
    const request = { paths: [absolutePath] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should reject requests with empty paths array based on Zod schema', async () => {
    const request = { paths: [] };
    await expect(handleCreateDirectoriesInternal(request, mockDependencies)).rejects.toThrow(
      McpError,
    );
    await expect(handleCreateDirectoriesInternal(request, mockDependencies)).rejects.toThrow(
      /Paths array cannot be empty/,
    );
  });

  it('should return error when attempting to create the project root', async () => {
    vi.mocked(resolvePath).mockImplementationOnce((relativePath: string): string => {
      if (relativePath === 'try_root') return mockDependencies.PROJECT_ROOT; // Use PROJECT_ROOT from deps
      const absolutePath = path.resolve(tempRootDir, relativePath);
      if (!absolutePath.startsWith(tempRootDir))
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Mocked Path traversal detected for ${relativePath}`,
        );
      return absolutePath;
    });
    const request = { paths: ['try_root'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Creating the project root is not allowed/);
    expect(result[0].resolvedPath).toBe(mockDependencies.PROJECT_ROOT);
  });

  it.skip('should handle unexpected errors during path resolution within the map', async () => {
    const genericError = new Error('Mocked unexpected resolve error');
    vi.mocked(resolvePath).mockImplementationOnce((relativePath: string): string => {
      if (relativePath === 'unexpected_resolve_error') throw genericError;
      const absolutePath = path.resolve(tempRootDir, relativePath);
      if (!absolutePath.startsWith(tempRootDir))
        throw new McpError(ErrorCode.InvalidRequest, 'Traversal');
      return absolutePath;
    });
    const request = { paths: ['goodDir', 'unexpected_resolve_error'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(2);
    const goodResult = result.find((r: CreateDirResultForTest) => r.path === 'goodDir');
    const badResult = result.find(
      (r: CreateDirResultForTest) => r.path === 'unexpected_resolve_error',
    );
    expect(goodResult?.success).toBe(true);
    expect(badResult?.success).toBe(false);
    expect(badResult?.error).toMatch(/Failed to create directory: Mocked unexpected resolve error/);
    expect(badResult?.resolvedPath).toBe('Resolution failed');
  });

  it('should correctly process settled results including rejections', () => {
    const originalPaths = ['path/success', 'path/failed'];
    const mockReason = new Error('Mocked rejection reason');
    const settledResults: PromiseSettledResult<CreateDirResultForTest>[] = [
      {
        status: 'fulfilled',
        value: {
          path: 'path/success',
          success: true,
          resolvedPath: '/mock/resolved/path/success',
        },
      },
      { status: 'rejected', reason: mockReason },
    ];
    const processed = processSettledResults(settledResults, originalPaths);
    expect(processed).toHaveLength(2);
    expect(processed[0]).toEqual({
      path: 'path/success',
      success: true,
      resolvedPath: '/mock/resolved/path/success',
    });
    expect(processed[1]).toEqual({
      path: 'path/failed',
      success: false,
      error: `Unexpected error during processing: ${mockReason.message}`,
      resolvedPath: 'Unknown on rejection',
    });
  });

  it('should throw McpError for invalid top-level arguments (e.g., paths not an array)', async () => {
    const invalidRequest = { paths: 'not-an-array' };
    await expect(handleCreateDirectoriesInternal(invalidRequest, mockDependencies)).rejects.toThrow(
      McpError,
    );
    await expect(handleCreateDirectoriesInternal(invalidRequest, mockDependencies)).rejects.toThrow(
      /Invalid arguments: paths/,
    );
  });

  // --- New Tests for Error Handling ---

  it('should handle EPERM/EACCES errors during directory creation', async () => {
    // Mock the mkdir dependency to throw a permission error
    mockMkdir.mockImplementation(async () => {
      const error = new Error('Operation not permitted') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });
    const request = { paths: ['perm_denied_dir'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Permission denied creating directory/);
    expect(result[0].path).toBe('perm_denied_dir');
    // No need to restore spy, restoreAllMocks in afterEach handles vi.fn mocks
  });

  it('should handle errors when stating an existing path in EEXIST handler', async () => {
    // Mock the mkdir dependency to throw EEXIST first
    mockMkdir.mockImplementation(async () => {
      const error = new Error('File already exists') as NodeJS.ErrnoException;
      error.code = 'EEXIST';
      throw error;
    });
    // Mock the stat dependency to throw an error *after* mkdir fails with EEXIST
    mockStat.mockImplementation(async () => {
      throw new Error('Mocked stat error');
    });
    const request = { paths: ['stat_error_dir'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Failed to stat existing path: Mocked stat error/);
    expect(result[0].path).toBe('stat_error_dir');
    // No need to restore spies
  });

  it('should handle McpError from resolvePath during creation', async () => {
    // Mock resolvePath dependency to throw McpError
    const mcpError = new McpError(ErrorCode.InvalidRequest, 'Mocked resolve error');
    vi.mocked(mockDependencies.resolvePath).mockImplementationOnce(() => {
      // Mock via deps object
      throw mcpError;
    });
    const request = { paths: ['resolve_mcp_error'] };
    const rawResult = await handleCreateDirectoriesInternal(request, mockDependencies);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toBe(mcpError.message);
    expect(result[0].path).toBe('resolve_mcp_error');
    expect(result[0].resolvedPath).toBe('Resolution failed');
  });
}); // End of describe block
