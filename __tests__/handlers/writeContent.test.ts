import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import type { PathLike } from 'fs'; // Import PathLike type
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'; // Re-add ErrorCode
import {
  createTemporaryFilesystem,
  cleanupTemporaryFilesystem,
} from '../testUtils.js';

// Remove vi.mock for pathUtils

// Import the core function and types
import type { WriteContentDependencies } from '../../src/handlers/writeContent.js';
// Import the internal function for testing
import { handleWriteContentFunc } from '../../src/handlers/writeContent.js';

// Define the initial structure for the temporary filesystem
const initialTestStructure = {
  'existingFile.txt': 'Initial content.',
  dir1: {}, // Existing directory
};

let tempRootDir: string;

describe('handleWriteContent Integration Tests', () => {
  let mockDependencies: WriteContentDependencies; // Restore declaration
  let mockWriteFile: Mock; // Declare mock function variable
  let mockAppendFile: Mock; // Restore declaration
  let mockMkdir: Mock; // Restore declaration
  let mockStat: Mock; // Declare mock function variable for stat - Still used in a test
  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(initialTestStructure);

    // Mock resolvePath implementation is now defined within mockDependencies below

    const actualFsPromises = (await vi.importActual<typeof import('fs')>('fs'))
      .promises;

    // Create mock functions for dependencies used by writeContent
    mockWriteFile = vi.fn().mockImplementation(actualFsPromises.writeFile);
    mockAppendFile = vi.fn().mockImplementation(actualFsPromises.appendFile); // Restore assignment
    mockMkdir = vi.fn().mockImplementation(actualFsPromises.mkdir); // Restore assignment
    mockStat = vi.fn().mockImplementation(actualFsPromises.stat);

    // Restore mock dependencies object assignment
    mockDependencies = {
      writeFile: mockWriteFile,
      mkdir: mockMkdir,
      stat: mockStat,
      appendFile: mockAppendFile,
      resolvePath: vi.fn((relativePath: string): string => {
        const root = tempRootDir!;
        if (path.isAbsolute(relativePath)) {
          throw new McpError(
            ErrorCode.InvalidParams, // Need ErrorCode import back
            `Mocked Absolute paths are not allowed for ${relativePath}`,
          );
        }
        const absolutePath = path.resolve(root, relativePath);
        if (!absolutePath.startsWith(root)) {
          throw new McpError(
            ErrorCode.InvalidRequest, // Need ErrorCode import back
            `Mocked Path traversal detected for ${relativePath}`,
          );
        }
        return absolutePath;
      }),
      PROJECT_ROOT: tempRootDir!,
      pathDirname: path.dirname,
    };
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    vi.clearAllMocks(); // Clear all mocks
  });

  it('should write content to new files', async () => {
    const request = {
      items: [
        { path: 'newFile1.txt', content: 'Content for new file 1' },
        { path: 'dir2/newFile2.log', content: 'Log entry' }, // Should create dir2
      ],
    };
    const rawResult = await handleWriteContentFunc(mockDependencies, request); // Use internal func + deps
    const result = JSON.parse(rawResult.content[0].text); // Assuming similar return structure

    expect(result).toHaveLength(2);
    // Check the actual returned structure
    expect(result[0]).toEqual({
      path: 'newFile1.txt',
      success: true,
      operation: 'written',
    });
    expect(result[1]).toEqual({
      path: 'dir2/newFile2.log',
      success: true,
      operation: 'written',
    });

    // Verify file contents and directory creation
    const content1 = await fsPromises.readFile(
      path.join(tempRootDir, 'newFile1.txt'),
      'utf-8',
    );
    expect(content1).toBe('Content for new file 1');
    const content2 = await fsPromises.readFile(
      path.join(tempRootDir, 'dir2/newFile2.log'),
      'utf-8',
    );
    expect(content2).toBe('Log entry');
    const dir2Stat = await fsPromises.stat(path.join(tempRootDir, 'dir2'));
    expect(dir2Stat.isDirectory()).toBe(true);
  });

  it('should overwrite existing files by default', async () => {
    const request = {
      items: [{ path: 'existingFile.txt', content: 'Overwritten content.' }],
    };
    const rawResult = await handleWriteContentFunc(mockDependencies, request); // Use internal func + deps
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: 'existingFile.txt',
      success: true,
      operation: 'written',
    });

    // Verify file content
    const content = await fsPromises.readFile(
      path.join(tempRootDir, 'existingFile.txt'),
      'utf-8',
    );
    expect(content).toBe('Overwritten content.');
  });

  it('should append content when append flag is true', async () => {
    const request = {
      items: [
        {
          path: 'existingFile.txt',
          content: ' Appended content.',
          append: true,
        },
      ],
    };
    // No need to mock appendFile here, beforeEach sets the default

    const rawResult = await handleWriteContentFunc(mockDependencies, request); // Use internal func + deps
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: 'existingFile.txt',
      success: true,
      operation: 'appended',
    });

    // Verify file content
    const content = await fsPromises.readFile(
      path.join(tempRootDir, 'existingFile.txt'),
      'utf-8',
    );
    expect(content).toBe('Initial content. Appended content.');
  });

  it('should handle mixed success and failure cases', async () => {
    const request = {
      items: [
        { path: 'success.txt', content: 'Good write' },
        { path: 'dir1', content: 'Trying to write to a directory' }, // Should fail
        { path: '../outside.txt', content: 'Traversal attempt' }, // Should fail via mockResolvePath
      ],
    };
    // Mock stat to simulate directory for 'dir1'
    const actualFsPromises = (await vi.importActual<typeof import('fs')>('fs'))
      .promises;
    mockStat.mockImplementation(async (p: PathLike) => {
      if (p.toString().endsWith('dir1')) {
        // Return stats indicating it's a directory
        const actualStat = await actualFsPromises.stat(
          path.join(tempRootDir, 'dir1'),
        );
        return { ...actualStat, isFile: () => false, isDirectory: () => true };
      }
      return actualFsPromises.stat(p);
    });
    // Mock writeFile to throw EISDIR for 'dir1'
    mockWriteFile.mockImplementation(
      async (p: PathLike, content: string | Buffer, options: any) => {
        if (p.toString().endsWith('dir1')) {
          const error = new Error(
            'EISDIR: illegal operation on a directory, write',
          ) as NodeJS.ErrnoException;
          error.code = 'EISDIR';
          throw error;
        }
        return actualFsPromises.writeFile(p, content, options);
      },
    );

    const rawResult = await handleWriteContentFunc(mockDependencies, request); // Use internal func + deps
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(3);

    const success = result.find((r: any) => r.path === 'success.txt');
    expect(success).toBeDefined();
    expect(success.success).toBe(true); // Check success flag
    expect(success.operation).toBe('written');
    expect(success.error).toBeUndefined();

    const dirWrite = result.find((r: any) => r.path === 'dir1');
    expect(dirWrite).toBeDefined();
    expect(dirWrite.success).toBe(false); // Check success flag
    expect(dirWrite.error).toBeDefined();
    expect(dirWrite.error).toMatch(/EISDIR: illegal operation on a directory/); // Check error message

    const traversal = result.find((r: any) => r.path === '../outside.txt');
    expect(traversal).toBeDefined();
    expect(traversal.success).toBe(false); // Check success flag
    expect(traversal.error).toBeDefined();
    expect(traversal.error).toMatch(/Mocked Path traversal detected/); // Error from mock

    // Verify the successful write occurred
    const successContent = await fsPromises.readFile(
      path.join(tempRootDir, 'success.txt'),
      'utf-8',
    );
    expect(successContent).toBe('Good write');
  });

  it('should return error for absolute paths (caught by mock resolvePath)', async () => {
    const absolutePath = path.resolve(tempRootDir, 'file1.txt');
    const request = {
      items: [{ path: absolutePath, content: 'Absolute fail' }],
    };
    const rawResult = await handleWriteContentFunc(mockDependencies, request); // Use internal func + deps
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false); // Check success flag
    expect(result[0].error).toBeDefined();
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should reject requests with empty items array based on Zod schema', async () => {
    const request = { items: [] };
    await expect(
      handleWriteContentFunc(mockDependencies, request),
    ).rejects.toThrow(
      // Use internal func + deps
      McpError,
    );
    await expect(
      handleWriteContentFunc(mockDependencies, request),
    ).rejects.toThrow(
      // Use internal func + deps
      /Items array cannot be empty/,
    );
  });

  it('should handle fs.writeFile errors (e.g., permission denied)', async () => {
    // Configure mockWriteFile to throw an EACCES error
    const permissionError = new Error(
      'Permission denied',
    ) as NodeJS.ErrnoException;
    permissionError.code = 'EACCES';
    mockWriteFile.mockImplementation(
      async (_p: PathLike, _content: string | Buffer, _options: any) => {
        // Prefix unused args with _
        throw permissionError;
      },
    );

    const request = {
      items: [{ path: 'permissionError.txt', content: 'This should fail' }],
    };
    const rawResult = await handleWriteContentFunc(mockDependencies, request); // Use internal func + deps
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toBeDefined();
    expect(result[0].error).toMatch(/Failed to write file: Permission denied/);
    expect(mockWriteFile).toHaveBeenCalledTimes(1); // Verify the mock was called
  });

  it('should return error when attempting to write directly to project root', async () => {
    const request = {
      items: [{ path: '.', content: 'Attempt to write to root' }],
    };
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toBeDefined();
    expect(result[0].error).toMatch(
      /Writing directly to the project root is not allowed/,
    );
  });

  it('should handle unexpected errors during processSingleWriteOperation', async () => {
    const unexpectedError = new Error('Unexpected processing error');
    // Mock processSingleWriteOperation indirectly by mocking a dependency it uses
    (mockDependencies.resolvePath as Mock).mockImplementation(
      (relativePath: string) => {
        // Assert as Mock
        if (relativePath === 'fail_unexpectedly.txt') {
          throw unexpectedError;
        }
        // Default mock behavior for other paths
        const root = tempRootDir!;
        const absolutePath = path.resolve(root, relativePath);
        if (!absolutePath.startsWith(root)) {
          throw new McpError(ErrorCode.InvalidRequest, 'Traversal');
        }
        return absolutePath;
      },
    );

    const request = {
      items: [
        { path: 'success.txt', content: 'Good' },
        { path: 'fail_unexpectedly.txt', content: 'Bad' },
      ],
    };

    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(2);

    const successResult = result.find((r: any) => r.path === 'success.txt');
    expect(successResult?.success).toBe(true);

    const failureResult = result.find(
      (r: any) => r.path === 'fail_unexpectedly.txt',
    );
    expect(failureResult?.success).toBe(false);
    expect(failureResult?.error).toBeDefined();
    // Check if the error message includes the unexpected error's message
    // The error comes from resolvePath mock, so it should be the direct message
    expect(failureResult?.error).toMatch(/Unexpected processing error/);
  });

  it('should throw McpError for invalid top-level arguments (e.g., items not an array)', async () => {
    const invalidRequest = { items: 'not-an-array' }; // Invalid structure
    await expect(
      handleWriteContentFunc(mockDependencies, invalidRequest),
    ).rejects.toThrow(McpError);
    await expect(
      handleWriteContentFunc(mockDependencies, invalidRequest),
    ).rejects.toThrow(/Invalid arguments: items/); // Check Zod error message
  });
});


  it('should throw McpError for non-Zod errors during argument parsing', async () => {
    // Mock the schema parse method to throw a generic error
    const genericError = new Error('Generic parsing error');
    const writeContentModule = await import('../../src/handlers/writeContent.js');
    const parseSpy = vi
      .spyOn(writeContentModule.WriteContentArgsSchema, 'parse')
      .mockImplementation(() => {
        throw genericError;
      });

    const request = { items: [{ path: 'a', content: 'b' }] }; // Valid structure, but parse will fail

    await expect(
      handleWriteContentFunc(mockDependencies, request),
    ).rejects.toThrow(McpError);
    await expect(
      handleWriteContentFunc(mockDependencies, request),
    ).rejects.toThrow(/Argument validation failed/); // Check the generic error message

    parseSpy.mockRestore();
  });

  it('should handle unexpected rejections in processSettledResults', async () => {
    // Mock the internal processing function to throw for one path
    const genericError = new Error('Internal processing failed unexpectedly');
    const writeContentModule = await import('../../src/handlers/writeContent.js');
    const processSpy = vi
      .spyOn(writeContentModule as any, 'processSingleWriteOperation') // Use 'as any' to bypass private access issues if needed
      .mockImplementation(async (item: any) => {
        if (item.path === 'fail_processing') {
          throw genericError;
        }
        return { path: item.path.replace(/\\/g, '/'), success: true, operation: 'written' }; // Simplified success
      });

    const request = {
      items: [
        { path: 'goodFile.txt', content: 'Good' },
        { path: 'fail_processing', content: 'Bad' },
      ],
    };
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(2);
    const goodResult = result.find((r: any) => r.path === 'goodFile.txt');
    const badResult = result.find((r: any) => r.path === 'fail_processing');

    expect(goodResult?.success).toBe(true);
    expect(badResult?.success).toBe(false);
    expect(badResult?.error).toMatch(
      /Unexpected error during processing: Internal processing failed unexpectedly/,
    );

    processSpy.mockRestore();
  });

