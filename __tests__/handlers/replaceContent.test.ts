import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  createTemporaryFilesystem,
  cleanupTemporaryFilesystem,
} from '../testUtils.js';

// Mock pathUtils BEFORE importing the handler
const mockResolvePath = vi.fn<(userPath: string) => string>();
vi.mock('../../src/utils/pathUtils.js', () => ({
  PROJECT_ROOT: 'mocked/project/root', // Keep simple for now
  resolvePath: mockResolvePath,
}));

// Import the internal function, deps type, and exported helper
const {
  handleReplaceContentInternal,
  // ReplaceContentDeps, // Removed unused import
  processSettledReplaceResults, // Import the helper
} = await import('../../src/handlers/replaceContent.js');
import type { ReplaceContentDeps } from '../../src/handlers/replaceContent.js'; // Import type separately

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

describe('handleReplaceContent Integration Tests', () => {
  let mockDependencies: ReplaceContentDeps;
  let mockReadFile: Mock;
  let mockWriteFile: Mock;
  let mockStat: Mock;

  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(initialTestStructure);

    // Mock implementations for dependencies
    const actualFsPromises =
      await vi.importActual<typeof fsPromises>('fs/promises');
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
      resolvePath: mockResolvePath, // Use the vi.fn mock directly
    };
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    vi.restoreAllMocks(); // Use restoreAllMocks to reset spies/mocks
  });

  it('should replace simple text in specified files', async () => {
    const request = {
      paths: ['fileA.txt', 'fileB.log'],
      operations: [{ search: 'world', replace: 'planet' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    // Updated to access data directly
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(2);
    expect(resultsArray?.[0]).toEqual({
      file: 'fileA.txt',
      modified: true,
      replacements: 2,
    });
    expect(resultsArray?.[1]).toEqual({
      file: 'fileB.log',
      modified: true,
      replacements: 2,
    });

    const contentA = await fsPromises.readFile(
      path.join(tempRootDir, 'fileA.txt'),
      'utf-8',
    );
    expect(contentA).toBe('Hello planet, planet!');
    const contentB = await fsPromises.readFile(
      path.join(tempRootDir, 'fileB.log'),
      'utf-8',
    );
    expect(contentB).toBe(
      'Error: planet not found.\nWarning: planet might be deprecated.',
    );
  });

  it('should handle multiple operations sequentially', async () => {
    const request = {
      paths: ['fileA.txt'],
      operations: [
        { search: 'world', replace: 'galaxy' },
        { search: 'galaxy', replace: 'universe' },
      ],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    // Replacements are counted per operation on the state *before* that operation
    expect(resultsArray?.[0]).toEqual({
      file: 'fileA.txt',
      modified: true,
      replacements: 4,
    }); // 2 from op1 + 2 from op2

    const contentA = await fsPromises.readFile(
      path.join(tempRootDir, 'fileA.txt'),
      'utf-8',
    );
    expect(contentA).toBe('Hello universe, universe!');
  });

  it('should use regex for replacement', async () => {
    const request = {
      paths: ['fileB.log'],
      operations: [
        { search: '^(Error|Warning):', replace: 'Log[$1]:', use_regex: true },
      ],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0]).toEqual({
      file: 'fileB.log',
      modified: true,
      replacements: 2,
    });

    const contentB = await fsPromises.readFile(
      path.join(tempRootDir, 'fileB.log'),
      'utf-8',
    );
    expect(contentB).toBe(
      'Log[Error]: world not found.\nLog[Warning]: world might be deprecated.',
    );
  });

  it('should handle case-insensitive replacement', async () => {
    const request = {
      paths: ['fileA.txt'],
      operations: [
        { search: 'hello', replace: 'Greetings', ignore_case: true },
      ],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0]).toEqual({
      file: 'fileA.txt',
      modified: true,
      replacements: 1,
    });

    const contentA = await fsPromises.readFile(
      path.join(tempRootDir, 'fileA.txt'),
      'utf-8',
    );
    expect(contentA).toBe('Greetings world, world!');
  });

  it('should report 0 replacements if search term not found', async () => {
    const request = {
      paths: ['noReplace.txt'],
      operations: [{ search: 'world', replace: 'planet' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0]).toEqual({
      file: 'noReplace.txt',
      modified: false,
      replacements: 0,
    });

    const content = await fsPromises.readFile(
      path.join(tempRootDir, 'noReplace.txt'),
      'utf-8',
    );
    expect(content).toBe('Nothing to see here.');
  });

  it('should return error if path does not exist', async () => {
    const request = {
      paths: ['nonexistent.txt'],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
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
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
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
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(3);
    const successA = resultsArray?.find((r: any) => r.file === 'fileA.txt');
    expect(successA).toEqual({
      file: 'fileA.txt',
      modified: true,
      replacements: 2,
    });
    const failNonExist = resultsArray?.find(
      (r: any) => r.file === 'nonexistent.txt',
    );
    expect(failNonExist?.modified).toBe(false);
    expect(failNonExist?.error).toMatch(/File not found/);
    const failDir = resultsArray?.find((r: any) => r.file === 'dir1');
    expect(failDir?.modified).toBe(false);
    expect(failDir?.error).toMatch(/Path is not a file/);

    const contentA = await fsPromises.readFile(
      path.join(tempRootDir, 'fileA.txt'),
      'utf-8',
    );
    expect(contentA).toBe('Hello sphere, sphere!');
  });

  it('should return error for absolute path (caught by mock resolvePath)', async () => {
    const absolutePath = path.resolve(tempRootDir, 'fileA.txt');
    const request = {
      paths: [absolutePath],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(
      /Mocked Absolute paths are not allowed/,
    );
  });

  it('should return error for path traversal (caught by mock resolvePath)', async () => {
    const request = {
      paths: ['../outside.txt'],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(/Mocked Path traversal detected/);
  });

  it('should reject requests with empty paths array based on Zod schema', async () => {
    const request = { paths: [], operations: [{ search: 'a', replace: 'b' }] };
    await expect(
      handleReplaceContentInternal(request, mockDependencies),
    ).rejects.toThrow(McpError);
    await expect(
      handleReplaceContentInternal(request, mockDependencies),
    ).rejects.toThrow(/Paths array cannot be empty/);
  });

  it('should reject requests with empty operations array based on Zod schema', async () => {
    const request = { paths: ['fileA.txt'], operations: [] };
    await expect(
      handleReplaceContentInternal(request, mockDependencies),
    ).rejects.toThrow(McpError);
    await expect(
      handleReplaceContentInternal(request, mockDependencies),
    ).rejects.toThrow(/Operations array cannot be empty/);
  });

  it('should handle McpError during path resolution', async () => {
    const request = {
      paths: ['../traversal.txt'], // Path that triggers McpError in mockResolvePath
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
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
      if (path.isAbsolute(relativePath))
        throw new McpError(ErrorCode.InvalidParams, `Absolute`);
      return absolutePath;
    });

    const request = {
      paths: [errorPath],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(
      /Failed to process file: Simulated generic error/,
    );
  });

  it('should handle replacing content in an empty file', async () => {
    const emptyFileName = 'emptyFile.txt';
    await fsPromises.writeFile(path.join(tempRootDir, emptyFileName), '');
    const request = {
      paths: [emptyFileName],
      operations: [{ search: 'anything', replace: 'something' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0]).toEqual({
      file: emptyFileName,
      modified: false,
      replacements: 0,
    });

    const content = await fsPromises.readFile(
      path.join(tempRootDir, emptyFileName),
      'utf-8',
    );
    expect(content).toBe('');
  });

  it('should handle replacing content with an empty string (deletion)', async () => {
    const request = {
      paths: ['fileA.txt'],
      operations: [{ search: 'world', replace: '' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0]).toEqual({
      file: 'fileA.txt',
      modified: true,
      replacements: 2,
    });

    const contentA = await fsPromises.readFile(
      path.join(tempRootDir, 'fileA.txt'),
      'utf-8',
    );
    expect(contentA).toBe('Hello , !');
  });

  // --- New Tests for Coverage ---

  it('should handle regex with line anchors (^ or $)', async () => {
    const request = {
      paths: ['fileB.log'],
      operations: [
        { search: '^Error.*', replace: 'FIRST_LINE_ERROR', use_regex: true }, // Matches first line
        // The second regex needs 'm' flag to match end of line, not just end of string
        {
          search: 'deprecated.$', // Corrected regex to only match the word at the end
          replace: 'LAST_LINE_DEPRECATED',
          use_regex: true,
        },
      ],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    // First op replaces 1, second replaces 1 (due to multiline flag being added)
    expect(resultsArray?.[0].replacements).toBe(2);
    const contentB = await fsPromises.readFile(
      path.join(tempRootDir, 'fileB.log'),
      'utf-8',
    );
    // Corrected expectation based on corrected regex
    expect(contentB).toBe(
      'FIRST_LINE_ERROR\nWarning: world might be LAST_LINE_DEPRECATED',
    );
  });

  it('should handle invalid regex pattern', async () => {
    const request = {
      paths: ['fileA.txt'],
      operations: [
        { search: '[invalid regex', replace: 'wont happen', use_regex: true },
      ],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0]).toEqual({
      file: 'fileA.txt',
      modified: false,
      replacements: 0,
    });
    const contentA = await fsPromises.readFile(
      path.join(tempRootDir, 'fileA.txt'),
      'utf-8',
    );
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
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false);
    expect(resultsArray?.[0].error).toMatch(
      /Permission denied processing file: fileA.txt/,
    );
    // Restore handled by afterEach
  });

  it('should handle write permission errors (EPERM)', async () => {
    // Mock the writeFile dependency
    mockWriteFile.mockImplementation(async () => {
      const error = new Error(
        'Operation not permitted',
      ) as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });
    const request = {
      paths: ['fileA.txt'],
      operations: [{ search: 'world', replace: 'planet' }],
    };
    const rawResult = await handleReplaceContentInternal(
      request,
      mockDependencies,
    );
    const resultsArray = rawResult.data?.results;
    expect(rawResult.success).toBe(true);
    expect(resultsArray).toBeDefined();
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray?.[0].modified).toBe(false); // Write failed
    expect(resultsArray?.[0].replacements).toBe(2); // Replacements happened before write attempt
    expect(resultsArray?.[0].error).toMatch(
      /Permission denied processing file: fileA.txt/,
    );
    // Restore handled by afterEach
  });

  it('should correctly process settled results including rejections (direct test)', () => {
    // processSettledReplaceResults is now imported at the top
    const originalPaths = ['path/success', 'path/failed'];
    const mockReason = new Error('Mocked rejection reason');
    const settledResults: PromiseSettledResult<any>[] = [
      {
        status: 'fulfilled',
        value: { file: 'path/success', replacements: 1, modified: true },
      },
      { status: 'rejected', reason: mockReason },
    ];

    const processed = processSettledReplaceResults(
      settledResults,
      originalPaths,
    );

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
