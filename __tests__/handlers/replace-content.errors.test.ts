import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { ReplaceContentDeps, ReplaceResult } from '../../src/handlers/replace-content.js';

import { createTemporaryFilesystem, cleanupTemporaryFilesystem } from '../test-utils.js';

// Set up mocks BEFORE importing
const mockResolvePath = vi.fn((path: string): string => path);
vi.mock('../../src/utils/path-utils.js', () => ({
  PROJECT_ROOT: 'mocked/project/root', // Keep simple for now
  resolvePath: mockResolvePath,
}));

// Import the internal function, deps type, and exported helper
const { handleReplaceContentInternal, processSettledReplaceResults } = await import(
  '../../src/handlers/replace-content.js'
);

// Define the initial structure
const initialTestStructure = {
  'fileA.txt': 'Hello world, world!',
  'fileB.log': 'Error: world not found.\nWarning: world might be deprecated.',
  'noReplace.txt': 'Nothing to see here.',
  dir1: {
    'fileC.txt': 'Another world inside dir1.',
  },
};

let tempRootDir: string;

describe('handleReplaceContent Error & Edge Scenarios', () => {
  let mockDependencies: ReplaceContentDeps;
  let mockReadFile: Mock;
  let mockWriteFile: Mock;
  let mockStat: Mock;

  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(initialTestStructure);

    // Mock implementations for dependencies
    const actualFsPromises = await vi.importActual<typeof fsPromises>('fs/promises');
    mockReadFile = vi.fn().mockImplementation(actualFsPromises.readFile);
    mockWriteFile = vi.fn().mockImplementation(actualFsPromises.writeFile);
    mockStat = vi.fn().mockImplementation(actualFsPromises.stat);

    // Configure the mock resolvePath
    mockResolvePath.mockImplementation((relativePath: string): string => {
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
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      stat: mockStat,
      resolvePath: mockResolvePath as unknown as () => string,
    };
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    vi.restoreAllMocks(); // Use restoreAllMocks to reset spies/mocks
  });

  it('should return error if path does not exist', async () => {
    const request = {
      paths: ['nonexistent.txt'],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(/File not found/);
  });

  it('should return error if path is a directory', async () => {
    const request = {
      paths: ['dir1'],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(/Path is not a file/);
  });

  it('should handle mixed success and failure paths', async () => {
    const request = {
      paths: ['fileA.txt', 'nonexistent.txt', 'dir1'],
      operations: [{ search: 'world', replace: 'sphere' }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(3);
    const successA = resultsArray?.find((r: { file: string }) => r.file === 'fileA.txt');
    expect(successA).toEqual({
      file: 'fileA.txt',
      modified: true,
      replacements: 2,
    });
    const failNonExist = resultsArray?.find((r: { file: string }) => r.file === 'nonexistent.txt');
    expect(failNonExist?.modified).toBe(false);
    expect(failNonExist?.error).toMatch(/File not found/);
    const failDir = resultsArray?.find((r: { file: string }) => r.file === 'dir1');
    expect(failDir?.modified).toBe(false);
    expect(failDir?.error).toMatch(/Path is not a file/);

    const contentA = await fsPromises.readFile(path.join(tempRootDir, 'fileA.txt'), 'utf8');
    expect(contentA).toBe('Hello sphere, sphere!');
  });

  it('should return error for absolute path (caught by mock resolvePath)', async () => {
    const absolutePath = path.resolve(tempRootDir, 'fileA.txt');
    const request = {
      paths: [absolutePath],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should return error for path traversal (caught by mock resolvePath)', async () => {
    const request = {
      paths: ['../outside.txt'],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(/Mocked Path traversal detected/);
  });

  it('should reject requests with empty paths array based on Zod schema', async () => {
    const request = { paths: [], operations: [{ search: 'a', replace: 'b' }] };
    await expect(handleReplaceContentInternal(request, mockDependencies)).rejects.toThrow(McpError);
    await expect(handleReplaceContentInternal(request, mockDependencies)).rejects.toThrow(
      /Paths array cannot be empty/,
    );
  });

  it('should reject requests with empty operations array based on Zod schema', async () => {
    const request = { paths: ['fileA.txt'], operations: [] };
    await expect(handleReplaceContentInternal(request, mockDependencies)).rejects.toThrow(McpError);
    await expect(handleReplaceContentInternal(request, mockDependencies)).rejects.toThrow(
      /Operations array cannot be empty/,
    );
  });

  it('should handle McpError during path resolution', async () => {
    const request = {
      paths: ['../traversal.txt'], // Path that triggers McpError in mockResolvePath
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(/Mocked Path traversal detected/);
  });

  it('should handle generic errors during path resolution or fs operations', async () => {
    const errorPath = 'genericErrorFile.txt';
    const genericErrorMessage = 'Simulated generic error';
    mockResolvePath.mockImplementationOnce((relativePath: string): string => {
      if (relativePath === errorPath) throw new Error(genericErrorMessage);
      const absolutePath = path.resolve(tempRootDir, relativePath);
      if (!absolutePath.startsWith(tempRootDir))
        throw new McpError(ErrorCode.InvalidRequest, `Traversal`);
      if (path.isAbsolute(relativePath)) throw new McpError(ErrorCode.InvalidParams, `Absolute`);
      return absolutePath;
    });

    const request = {
      paths: [errorPath],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(/Failed to process file: Simulated generic error/);
  });

  it('should handle invalid regex pattern', async () => {
    const request = {
      paths: ['fileA.txt'],
      operations: [{ search: '[invalid regex', replace: 'wont happen', use_regex: true }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0]).toEqual({
      file: 'fileA.txt',
      modified: false,
      replacements: 0,
    });
    const contentA = await fsPromises.readFile(path.join(tempRootDir, 'fileA.txt'), 'utf8');
    expect(contentA).toBe('Hello world, world!');
  });

  it('should handle read permission errors (EACCES)', async () => {
    // Mock the readFile dependency
    mockReadFile.mockImplementation(async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    const request = {
      paths: ['fileA.txt'],
      operations: [{ search: 'world', replace: 'planet' }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(/Permission denied processing file: fileA.txt/);
    // Restore handled by afterEach
  });

  it('should handle write permission errors (EPERM)', async () => {
    // Mock the writeFile dependency
    mockWriteFile.mockImplementation(async () => {
      const error = new Error('Operation not permitted') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });
    const request = {
      paths: ['fileA.txt'],
      operations: [{ search: 'world', replace: 'planet' }],
    };
    const rawResult = await handleReplaceContentInternal(request, mockDependencies);
    const resultsArray = rawResult.data?.results as ReplaceResult[];
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false); // Write failed
    expect(resultsArray?.[0].replacements).toBe(2); // Replacements happened before write attempt
    expect(resultsArray?.[0].error).toMatch(/Permission denied processing file: fileA.txt/);
    // Restore handled by afterEach
  });

  it('should correctly process settled results including rejections (direct test)', () => {
    // processSettledReplaceResults is now imported at the top
    const originalPaths = ['path/success', 'path/failed'];
    const mockReason = new Error('Mocked rejection reason');
    const settledResults: PromiseSettledResult<ReplaceResult>[] = [
      {
        status: 'fulfilled',
        value: { file: 'path/success', replacements: 1, modified: true },
      },
      { status: 'rejected', reason: mockReason },
    ];

    const processed = processSettledReplaceResults(settledResults, originalPaths);

    expect(processed).toHaveLength(2);
    expect(processed[0]).toEqual({
      file: 'path/success',
      replacements: 1,
      modified: true,
    });
    expect(processed[1]).toEqual({
      file: 'path/failed',
      replacements: 0,
      modified: false,
      error: `Unexpected error during file processing: ${mockReason.message}`,
    });
  });
});
