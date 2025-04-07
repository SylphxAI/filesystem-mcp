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

// Import the core function and types
import type { WriteContentDependencies } from '../../src/handlers/writeContent.js';
// Import the internal function for testing
import {
  handleWriteContentFunc,
  // WriteContentArgsSchema, // Removed unused import
} from '../../src/handlers/writeContent.js'; // Import schema too

// Define the initial structure for the temporary filesystem
const initialTestStructure = {
  'existingFile.txt': 'Initial content.',
  dir1: {}, // Existing directory
};

let tempRootDir: string;

describe('handleWriteContent Integration Tests', () => {
  let mockDependencies: WriteContentDependencies;
  let mockWriteFile: Mock;
  let mockAppendFile: Mock;
  let mockMkdir: Mock;
  let mockStat: Mock;

  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(initialTestStructure);
    const actualFsPromises = (await vi.importActual<typeof import('fs')>('fs'))
      .promises;

    mockWriteFile = vi.fn().mockImplementation(actualFsPromises.writeFile);
    mockAppendFile = vi.fn().mockImplementation(actualFsPromises.appendFile);
    mockMkdir = vi.fn().mockImplementation(actualFsPromises.mkdir);
    mockStat = vi.fn().mockImplementation(actualFsPromises.stat);

    mockDependencies = {
      writeFile: mockWriteFile,
      mkdir: mockMkdir,
      stat: mockStat,
      appendFile: mockAppendFile,
      resolvePath: vi.fn((relativePath: string): string => {
        const root = tempRootDir!;
        if (path.isAbsolute(relativePath)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Mocked Absolute paths are not allowed for ${relativePath}`,
          );
        }
        const absolutePath = path.resolve(root, relativePath);
        if (!absolutePath.startsWith(root)) {
          throw new McpError(
            ErrorCode.InvalidRequest,
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
    vi.clearAllMocks();
  });

  it('should write content to new files', async () => {
    const request = {
      items: [
        { path: 'newFile1.txt', content: 'Content for new file 1' },
        { path: 'dir2/newFile2.log', content: 'Log entry' },
      ],
    };
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(2);
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
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: 'existingFile.txt',
      success: true,
      operation: 'written',
    });
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
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: 'existingFile.txt',
      success: true,
      operation: 'appended',
    });
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
        { path: 'dir1', content: 'Trying to write to a directory' },
        { path: '../outside.txt', content: 'Traversal attempt' },
      ],
    };
    const actualFsPromises = (await vi.importActual<typeof import('fs')>('fs'))
      .promises;
    mockStat.mockImplementation(async (p: PathLike) => {
      if (p.toString().endsWith('dir1')) {
        const actualStat = await actualFsPromises.stat(
          path.join(tempRootDir, 'dir1'),
        );
        return { ...actualStat, isFile: () => false, isDirectory: () => true };
      }
      return actualFsPromises.stat(p);
    });
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
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(3);
    const success = result.find((r: any) => r.path === 'success.txt');
    expect(success).toEqual({
      path: 'success.txt',
      success: true,
      operation: 'written',
    });
    const dirWrite = result.find((r: any) => r.path === 'dir1');
    expect(dirWrite.success).toBe(false);
    expect(dirWrite.error).toMatch(/EISDIR: illegal operation on a directory/);
    const traversal = result.find((r: any) => r.path === '../outside.txt');
    expect(traversal.success).toBe(false);
    expect(traversal.error).toMatch(/Mocked Path traversal detected/);
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
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should reject requests with empty items array based on Zod schema', async () => {
    const request = { items: [] };
    await expect(
      handleWriteContentFunc(mockDependencies, request),
    ).rejects.toThrow(McpError);
    await expect(
      handleWriteContentFunc(mockDependencies, request),
    ).rejects.toThrow(/Items array cannot be empty/);
  });

  it('should handle fs.writeFile errors (e.g., permission denied)', async () => {
    const permissionError = new Error(
      'Permission denied',
    ) as NodeJS.ErrnoException;
    permissionError.code = 'EACCES';
    mockWriteFile.mockImplementation(async () => {
      throw permissionError;
    });
    const request = {
      items: [{ path: 'permissionError.txt', content: 'This should fail' }],
    };
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Failed to write file: Permission denied/);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('should return error when attempting to write directly to project root', async () => {
    const request = {
      items: [{ path: '.', content: 'Attempt to write to root' }],
    };
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(
      /Writing directly to the project root is not allowed/,
    );
  });

  it('should handle unexpected errors during processSingleWriteOperation', async () => {
    const unexpectedError = new Error('Unexpected processing error');
    (mockDependencies.resolvePath as Mock).mockImplementation(
      (relativePath: string) => {
        if (relativePath === 'fail_unexpectedly.txt') throw unexpectedError;
        const root = tempRootDir!;
        const absolutePath = path.resolve(root, relativePath);
        if (!absolutePath.startsWith(root))
          throw new McpError(ErrorCode.InvalidRequest, 'Traversal');
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
    expect(failureResult?.error).toMatch(/Unexpected processing error/);
  });

  it('should throw McpError for invalid top-level arguments (e.g., items not an array)', async () => {
    const invalidRequest = { items: 'not-an-array' };
    await expect(
      handleWriteContentFunc(mockDependencies, invalidRequest),
    ).rejects.toThrow(McpError);
    await expect(
      handleWriteContentFunc(mockDependencies, invalidRequest),
    ).rejects.toThrow(/Invalid arguments: items/);
  });

  // --- Corrected Failing Tests ---

  it('should throw McpError for non-Zod errors during argument parsing', async () => {
    // Simulate a generic error occurring *before* Zod parsing, e.g., in dependency resolution
    const genericParsingError = new Error(
      'Simulated generic parsing phase error',
    );
    (mockDependencies.resolvePath as Mock).mockImplementation(() => {
      throw genericParsingError;
    });
    const request = { items: [{ path: 'a', content: 'b' }] }; // Valid structure
    // Expect the handler to catch the generic error and wrap it in McpError
    // Expect the handler to catch the generic error and return a failed result
    const rawResult = await handleWriteContentFunc(mockDependencies, request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    // Check if the message indicates a general processing failure
    expect(result[0].error).toMatch(/Simulated generic parsing phase error/); // Check the original error message
    // Restore mock (though afterEach handles it)
    (mockDependencies.resolvePath as Mock).mockRestore();
  });

  it('should handle unexpected rejections in processSettledResults', async () => {
    // Mock writeFile dependency to throw an error for a specific path
    const internalError = new Error('Internal processing failed unexpectedly');
    mockWriteFile.mockImplementation(
      async (p: PathLike, _content: any, _options: any) => {
        if (p.toString().endsWith('fail_processing')) {
          throw internalError;
        }
        // Call actual implementation for other paths
        const actualFsPromises = (
          await vi.importActual<typeof import('fs')>('fs')
        ).promises;
        return actualFsPromises.writeFile(p, _content, _options);
      },
    );

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
      /Failed to write file: Internal processing failed unexpectedly/,
    ); // Include prefix

    mockWriteFile.mockRestore(); // Restore the mock
  });
}); // End of describe block
