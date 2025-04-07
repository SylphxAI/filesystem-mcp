// __tests__/handlers/editFile.test.ts
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach, // Restore afterEach
  // beforeAll, // Remove unused beforeAll
} from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js'; // Removed unused ErrorCode
import * as fsPromises from 'fs/promises'; // Import fsPromises
import type { PathLike, WriteFileOptions, StatOptions } from 'fs'; // Keep fs types
import type { Stats } from 'fs';
import path from 'path';
import * as diff from 'diff'; // Import diff module for mocking
import * as pathUtils from '../../src/utils/pathUtils.js'; // Import original pathUtils

// --- Define Mock Types ---
// Define simplified mock types matching EditFileDeps
type MockWriteFile = (
  path: PathLike | number, // Keep number for mock flexibility if needed
  data: string | NodeJS.ArrayBufferView,
  options?: WriteFileOptions | BufferEncoding | null,
) => Promise<void>;
// MockReadFile and MockStat remain similar but ensure consistency
type MockReadFile = (
  path: PathLike | number,
  options?: any, // Keep any for simplicity in mock
) => Promise<string | Buffer>;
type MockStat = (path: PathLike, opts?: StatOptions) => Promise<Stats>;

// --- Mock Dependencies using vi.mock (hoisted) ---
// Define mocks within the factory function for vi.mock
// Define mocks inside the factory

vi.mock('fs/promises', () => {
  // Define mocks *inside* the factory
  const mockReadFileFnInFactory = vi.fn<MockReadFile>();
  const mockWriteFileFnInFactory = vi.fn<MockWriteFile>();
  const mockStatFnInFactory = vi.fn<MockStat>();
  const mockMkdirFnInFactory = vi.fn();
  const mockAppendFileFnInFactory = vi.fn();
  const mockChmodFnInFactory = vi.fn();
  const mockChownFnInFactory = vi.fn();
  const mockUnlinkFnInFactory = vi.fn();
  const mockReaddirFnInFactory = vi.fn();
  const mockRenameFnInFactory = vi.fn();
  const mockCopyFileFnInFactory = vi.fn();

  const fsPromisesMockObject = {
    readFile: mockReadFileFnInFactory,
    writeFile: mockWriteFileFnInFactory,
    stat: mockStatFnInFactory,
    mkdir: mockMkdirFnInFactory,
    appendFile: mockAppendFileFnInFactory,
    chmod: mockChmodFnInFactory,
    chown: mockChownFnInFactory,
    unlink: mockUnlinkFnInFactory,
    readdir: mockReaddirFnInFactory,
    rename: mockRenameFnInFactory,
    copyFile: mockCopyFileFnInFactory,
  };
  return {
    ...fsPromisesMockObject,
    default: fsPromisesMockObject,
    promises: fsPromisesMockObject,
  };
});

// Remove vi.mock for pathUtils and the external mock function definition
// We will use vi.spyOn in beforeEach instead

vi.mock('detect-indent', () => ({
  default: vi.fn().mockReturnValue({ indent: '  ', type: 'space', amount: 2 }),
}));
vi.mock('diff', () => ({
  createPatch: vi.fn().mockReturnValue('mock diff content'),
}));

// Removed old jest.unstable_mockModule calls

// --- Test Suite ---
// Import the handler and internal function normally
import {
  handleEditFileInternal, // Import the internal function
  // editFileDefinition, // Removed unused import
} from '../../src/handlers/editFile.js';

describe('editFile Handler', () => {
  let mockDeps: any; // Declare mockDeps here, initialize in beforeEach

  beforeEach(() => {
    // Clear mocks before each test
    vi.clearAllMocks();

    // Default mock implementations SET INSIDE beforeEach using external vars
    const defaultMockStats = {
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      dev: 0,
      ino: 0,
      mode: 0,
      nlink: 0,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: 100,
      blksize: 4096,
      blocks: 1,
      atimeMs: Date.now(),
      mtimeMs: Date.now(),
      ctimeMs: Date.now(),
      birthtimeMs: Date.now(),
      atime: new Date(),
      mtime: new Date(),
      ctime: new Date(),
      birthtime: new Date(),
    } as Stats;
    // Use vi.mocked to access the mocked functions defined in the factory
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      'default mock read content',
    );
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.stat).mockResolvedValue(defaultMockStats);
    // Use vi.spyOn to mock resolvePath implementation for each test
    vi.spyOn(pathUtils, 'resolvePath').mockImplementation(
      (relativePath: string) => path.resolve(process.cwd(), relativePath),
    );
    // Initialize mockDeps inside beforeEach
    mockDeps = {
      writeFile: vi.mocked(fsPromises.writeFile), // Pass the mocked function
    };
    // Reset diff mock implementation before each test
    // Removed redundant mockReturnValue for diff.createPatch as it's mocked globally
  });

  // Restore mocks after each test if using spyOn/mockImplementationOnce in tests
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully replace a single line', async () => {
    const args = {
      changes: [
        {
          path: 'test.txt',
          start_line: 2,
          search_pattern: 'line 2',
          replace_content: 'replacement line 2',
        },
      ],
      output_diff: true,
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
      'line 1\nline 2\nline 3',
    );

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results).toHaveLength(1);
    expect(resultData.results[0].status).toBe('success');
    expect(resultData.results[0].path).toBe('test.txt');
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'test.txt'),
      'line 1\nreplacement line 2\nline 3',
      'utf-8',
    );
    expect(resultData.results[0].diff).toBe('mock diff content');
  });

  it('should handle insertion at the beginning', async () => {
    const args = {
      changes: [
        {
          path: 'insert.txt',
          start_line: 1,
          replace_content: 'inserted line 0',
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('line 1\nline 2');

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    // Expect no leading spaces when inserting at the beginning without detected indent
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'insert.txt'),
      'inserted line 0\nline 1\nline 2', // Removed leading spaces from expectation
      'utf-8',
    );
  });

  it('should handle deletion', async () => {
    const args = {
      changes: [
        { path: 'delete.txt', start_line: 2, search_pattern: 'line 2' },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
      'line 1\nline 2\nline 3',
    );

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'delete.txt'),
      'line 1\nline 3',
      'utf-8',
    );
  });

  it('should skip change if search pattern not found', async () => {
    const args = {
      changes: [
        {
          path: 'notfound.txt',
          start_line: 1,
          search_pattern: 'nonexistent pattern',
          replace_content: 'wont happen',
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('line 1\nline 2');

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('skipped');
    expect(resultData.results[0].message).toBe(
      // Exact match
      'No changes applied to the file.',
    );
    expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();
  });

  it('should return status failed if file not found on read', async () => {
    const args = {
      changes: [
        { path: 'nonexistent.txt', start_line: 1, replace_content: 'abc' },
      ],
    };
    const error = new Error('File not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    vi.spyOn(pathUtils, 'resolvePath').mockReturnValueOnce(
      path.resolve(process.cwd(), 'nonexistent.txt'),
    );
    vi.mocked(fsPromises.readFile).mockRejectedValueOnce(error);

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results).toHaveLength(1);
    expect(resultData.results[0].status).toBe('failed');
    expect(resultData.results[0].path).toBe('nonexistent.txt');
    expect(resultData.results[0].message).toMatch(
      /File not found: nonexistent.txt/i,
    );
    expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();
  });

  it('should correctly replace the long description string', async () => {
    const originalDescription =
      "    description: \"Write or append content to multiple specified files (creating directories if needed). NOTE: For modifying existing files, prefer using \\'edit_file\\' or \\'replace_content\\' for better performance, especially with large files. Use \\'write_content\\' primarily for creating new files or complete overwrites.\",";
    const newDescription =
      "    description: \"**Primary Use:** Create new files or completely overwrite existing ones. Can also append content. **Note:** For modifying *parts* of existing files, especially large ones, use \\'edit_file\\' or \\'replace_content\\' for better performance and precision. Automatically creates directories if needed.\",";
    const fileContent = `line 1\nline 2\n${originalDescription}\nline 4`;
    const startLine = 3;

    const args = {
      changes: [
        {
          path: 'description_test.ts',
          start_line: startLine,
          search_pattern: originalDescription,
          replace_content: newDescription,
          ignore_leading_whitespace: false,
          preserve_indentation: false,
        },
      ],
    };

    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(fileContent);

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'description_test.ts'),
      `line 1\nline 2\n${newDescription}\nline 4`,
      'utf-8',
    );
  });

  // Add more tests...

  // --- Regex Tests ---

  it('should successfully replace the first matched content using regex', async () => {
    // Test adjusted for match_occurrence=1
    const args = {
      changes: [
        {
          path: 'regex_replace.txt',
          start_line: 1,
          search_pattern: 'line \\d+', // ESCAPED backslash for \d
          replace_content: 'matched line',
          use_regex: true,
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
      'line 1\nline two\nline 3',
    );

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'regex_replace.txt'),
      'matched line\nline two\nline 3', // Expecting only the first match (line 1) to be replaced
      'utf-8',
    );
  });

  it('should successfully delete the first matched content using regex', async () => {
    // Test adjusted for match_occurrence=1
    const args = {
      changes: [
        {
          path: 'regex_delete.txt',
          start_line: 1,
          search_pattern: 'delete this \\d+\\n?', // ESCAPED backslashes for \d and \n
          use_regex: true,
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
      'keep this\ndelete this 1\nkeep this too\ndelete this 2',
    );

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'regex_delete.txt'),
      'keep this\nkeep this too\ndelete this 2', // Expecting only the first match ('delete this 1\\n') to be deleted
      'utf-8',
    );
  });

  it('should replace only the specified occurrence using regex', async () => {
    const args = {
      changes: [
        {
          path: 'regex_occurrence.txt',
          start_line: 1,
          search_pattern: 'target',
          replace_content: 'REPLACED',
          use_regex: true,
          match_occurrence: 2, // Target the second occurrence
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
      'target one\ntarget two\ntarget three',
    );

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'regex_occurrence.txt'),
      'target one\nREPLACED two\ntarget three',
      'utf-8',
    );
  });

  it('should delete only the specified occurrence using regex', async () => {
    const args = {
      changes: [
        {
          path: 'regex_delete_occurrence.txt',
          start_line: 1,
          search_pattern: 'delete me\\\\n?', // Match 'delete me' optionally followed by newline
          use_regex: true,
          match_occurrence: 2, // Target the second occurrence
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
      'line 1\\ndelete me\\nline 3\\ndelete me\\nline 5',
    );

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'regex_delete_occurrence.txt'),
      'line 1\\ndelete me\\nline 3\\nline 5', // Expecting only the second 'delete me\n' to be removed
      'utf-8',
    );
  });

  it('should delete only the specified occurrence using regex', async () => {
    const args = {
      changes: [
        {
          path: 'regex_delete_occurrence.txt',
          start_line: 1,
          search_pattern: 'delete me\\\\n?', // Match 'delete me' optionally followed by newline
          use_regex: true,
          match_occurrence: 2, // Target the second occurrence
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
      'line 1\\ndelete me\\nline 3\\ndelete me\\nline 5',
    );

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'regex_delete_occurrence.txt'),
      'line 1\\ndelete me\\nline 3\\nline 5', // Expecting only the second 'delete me\\n' to be removed
      'utf-8',
    );
  });

  it('should skip change if regex pattern is invalid', async () => {
    const args = {
      changes: [
        {
          path: 'invalid_regex.txt',
          start_line: 1,
          search_pattern: '[invalid regex', // Invalid regex
          replace_content: 'wont happen',
          use_regex: true,
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('some content');

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('skipped'); // Change is skipped internally, not failed
    expect(resultData.results[0].message).toBe(
      // Expect the skipped message
      'No changes applied to the file.',
    );
    expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();
  });

  it('should skip change if regex pattern is not found', async () => {
    const args = {
      changes: [
        {
          path: 'regex_notfound.txt',
          start_line: 1,

          search_pattern: 'nonexistent pattern \\d+', // Use double backslash for literal \d in RegExp constructor
          replace_content: 'wont happen',
          use_regex: true,
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('line 1\nline 2');

    const result = await handleEditFileInternal(args, mockDeps); // Pass mockDeps
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('skipped');
    expect(resultData.results[0].message).toBe(
      // Exact match
      'No changes applied to the file.',
    );
    expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();
  });

  // --- Error Handling and Edge Case Tests ---

  it('should throw McpError for invalid top-level arguments (e.g., changes not an array)', async () => {
    const invalidArgs = { changes: 'not-an-array' };
    await expect(handleEditFileInternal(invalidArgs, mockDeps)).rejects.toThrow(
      McpError,
    );
    await expect(handleEditFileInternal(invalidArgs, mockDeps)).rejects.toThrow(
      /Invalid arguments for editFile: changes: Expected array, received string/,
    );
  });

  it('should throw McpError for invalid change object (refine fails)', async () => {
    const invalidArgs = {
      changes: [
        {
          // Missing both search_pattern and replace_content
          path: 'refine_fail.txt',
          start_line: 1,
        },
      ],
    };
    // This validation happens *before* file read/write mocks are relevant
    await expect(handleEditFileInternal(invalidArgs, mockDeps)).rejects.toThrow(
      McpError,
    );
    await expect(handleEditFileInternal(invalidArgs, mockDeps)).rejects.toThrow(
      /Either 'search_pattern' or 'replace_content' must be provided/,
    );
  });

  it('should handle errors during diff generation', async () => {
    const args = {
      changes: [
        {
          path: 'diff_error.txt',
          start_line: 1,
          search_pattern: 'a',
          replace_content: 'b',
        },
      ],
      output_diff: true, // Ensure diff generation is attempted
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('a');
    // Mock createPatch to throw an error
    const diffError = new Error('Mocked diff generation error');
    // Need to mock the imported function directly
    // Use spyOn directly on the imported module object, no need to store the spy instance
    vi.spyOn(diff, 'createPatch').mockImplementationOnce(() => {
      throw diffError;
    });

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success'); // Write still succeeds
    expect(resultData.results[0].diff).toBe('Error generating diff.'); // Diff generation fails
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled(); // File should still be written
  });

  it('should handle errors during file writing', async () => {
    const args = {
      changes: [
        {
          path: 'write_error.txt',
          start_line: 1,
          search_pattern: 'a',
          replace_content: 'b',
        },
      ],
      dry_run: false, // Ensure write is attempted
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('a');
    // Mock writeFile to throw an error
    const writeError = new Error('Mocked write permission error');
    (writeError as NodeJS.ErrnoException).code = 'EACCES';
    vi.mocked(fsPromises.writeFile).mockImplementationOnce(async () => {
      throw writeError;
    });

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('failed');
    expect(resultData.results[0].message).toMatch(/Failed to write changes/);
    expect(resultData.results[0].message).toMatch(
      /Mocked write permission error/,
    );
    expect(resultData.results[0].diff).toBeUndefined(); // Diff should be cleared
  });

  it('should handle non-ENOENT errors during file reading', async () => {
    const args = {
      changes: [
        {
          path: 'read_perm_error.txt',
          start_line: 1,
          replace_content: 'abc',
        },
      ],
    };
    const readError = new Error('Mocked read permission error');
    (readError as NodeJS.ErrnoException).code = 'EACCES'; // Simulate permission error
    vi.spyOn(pathUtils, 'resolvePath').mockReturnValueOnce(
      path.resolve(process.cwd(), 'read_perm_error.txt'),
    );
    vi.mocked(fsPromises.readFile).mockRejectedValueOnce(readError);

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('failed');
    expect(resultData.results[0].message).toMatch(
      /Filesystem error \(EACCES\)/,
    );
  });

  it('should handle generic errors during file reading', async () => {
    const args = {
      changes: [
        {
          path: 'read_generic_error.txt',
          start_line: 1,
          replace_content: 'abc',
        },
      ],
    };
    const readError = new Error('Mocked generic read error');
    // Ensure no 'code' property is present
    delete (readError as any).code;
    vi.spyOn(pathUtils, 'resolvePath').mockReturnValueOnce(
      path.resolve(process.cwd(), 'read_generic_error.txt'),
    );
    vi.mocked(fsPromises.readFile).mockRejectedValueOnce(readError);

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('failed');
    expect(resultData.results[0].message).toMatch(
      /Unexpected error processing/,
    );
    expect(resultData.results[0].message).toMatch(/Mocked generic read error/);
  });

  it('should throw McpError for insertion without replace_content', async () => {
    const args = {
      changes: [
        {
          path: 'insert_error.txt',
          start_line: 1,
          search_pattern: undefined, // Explicitly undefined for insertion intent
          // Missing replace_content
        },
      ],
    };
    // Zod validation should catch this before file read
    await expect(handleEditFileInternal(args, mockDeps)).rejects.toThrow(
      McpError,
    );
    await expect(handleEditFileInternal(args, mockDeps)).rejects.toThrow(
      /Either 'search_pattern' or 'replace_content' must be provided/,
    );
  });

  it('should skip insertion with invalid start_line (0)', async () => {
    const args = {
      changes: [
        {
          path: 'insert_error_line.txt',
          start_line: 0, // Invalid start line (Zod validates >= 1)
          replace_content: 'abc',
        },
      ],
    };
    // This test case is tricky because Zod validation *should* catch this.
    // However, if it somehow bypassed Zod, the internal logic might skip.
    // Let's assume Zod catches it, so we expect an error throw.
    await expect(handleEditFileInternal(args, mockDeps)).rejects.toThrow(
      McpError,
    );
    await expect(handleEditFileInternal(args, mockDeps)).rejects.toThrow(
      /changes.0.start_line: Number must be greater than or equal to 1/,
    );
    // Keep this assertion in case Zod validation changes or fails
    // vi.mocked(fsPromises.readFile).mockResolvedValueOnce('line 1');
    // const result = await handleEditFileInternal(args, mockDeps);
    // const resultData = JSON.parse(result.content[0].text);
    // expect(resultData.results[0].status).toBe('skipped');
    // expect(resultData.results[0].message).toBe('No changes applied to the file.');
    // expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();
  });

  it('should skip insertion with invalid start_line (-1)', async () => {
    const args = {
      changes: [
        {
          path: 'insert_error_line_neg.txt',
          start_line: -1, // Invalid start line (Zod validates >= 1)
          replace_content: 'abc',
        },
      ],
    };
    // Similar to the above, expect Zod to catch this.
    await expect(handleEditFileInternal(args, mockDeps)).rejects.toThrow(
      McpError,
    );
    await expect(handleEditFileInternal(args, mockDeps)).rejects.toThrow(
      /changes.0.start_line: Number must be greater than or equal to 1/,
    );
    // Keep this assertion in case Zod validation changes or fails
    // vi.mocked(fsPromises.readFile).mockResolvedValueOnce('line 1');
    // const result = await handleEditFileInternal(args, mockDeps);
    // const resultData = JSON.parse(result.content[0].text);
    // expect(resultData.results[0].status).toBe('skipped');
    // expect(resultData.results[0].message).toBe('No changes applied to the file.');
    // expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();
  });

  it('should handle finalize when status is already failed', async () => {
    // Simulate a read error first
    const args = {
      changes: [
        {
          path: 'finalize_fail.txt',
          start_line: 1,
          replace_content: 'abc',
        },
      ],
    };
    const readError = new Error('Read failed first');
    vi.spyOn(pathUtils, 'resolvePath').mockReturnValueOnce(
      path.resolve(process.cwd(), 'finalize_fail.txt'),
    );
    vi.mocked(fsPromises.readFile).mockRejectedValueOnce(readError);

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('failed');
    expect(resultData.results[0].message).toMatch(/Read failed first/);
    expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled(); // Ensure write wasn't attempted
  });

  it('should return correct message for dry run success', async () => {
    const args = {
      changes: [
        {
          path: 'dry_run_test.txt',
          start_line: 1,
          search_pattern: 'a',
          replace_content: 'b',
        },
      ],
      dry_run: true, // Enable dry run
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('a');

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(resultData.results[0].message).toBe(
      'File changes calculated (dry run).',
    );
    expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled(); // Ensure write wasn't attempted
  });

  // --- editFileUtils specific tests ---

  it('should handle insertion at the end of the file', async () => {
    const args = {
      changes: [
        {
          path: 'insert_end.txt',
          start_line: 4, // Line after the last line
          replace_content: 'new last line',
          preserve_indentation: true, // Test indentation logic at end
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
      'line 1\n  line 2\nline 3',
    );

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    // Expect indentation from the *last* existing line to be applied
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'insert_end.txt'),
      'line 1\n  line 2\nline 3\nnew last line', // Indentation should be based on line 3 (none)
      'utf-8',
    );
  });

  it('should handle insertion at the end with indentation', async () => {
    const args = {
      changes: [
        {
          path: 'insert_end_indent.txt',
          start_line: 3, // Insert after line 2
          replace_content: 'new line 2.5',
          preserve_indentation: true,
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('line 1\n  line 2'); // Last line has indent

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    // Expect indentation from line 2 to be applied
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'insert_end_indent.txt'),
      'line 1\n  line 2\n  new line 2.5', // Should have indent from line 2
      'utf-8',
    );
  });

  it('should skip regex replace if search_pattern is missing', async () => {
    const args = {
      changes: [
        {
          path: 'regex_missing_search.txt',
          start_line: 1,
          replace_content: 'abc',
          use_regex: true,
          // Missing search_pattern
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('line 1');

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    // This is treated as an insertion because search_pattern is missing but replace_content exists
    expect(resultData.results[0].status).toBe('success');
    // Check if write was called (it should have been for insertion)
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled();
  });

  it('should skip plain text replace if search_pattern is missing', async () => {
    const args = {
      changes: [
        {
          path: 'plain_missing_search.txt',
          start_line: 1,
          replace_content: 'abc',
          use_regex: false,
          // Missing search_pattern
        },
      ],
    };
    vi.mocked(fsPromises.readFile).mockResolvedValueOnce('line 1');

    const result = await handleEditFileInternal(args, mockDeps);
    const resultData = JSON.parse(result.content[0].text);

    // This is treated as an insertion because search_pattern is missing but replace_content exists
    expect(resultData.results[0].status).toBe('success');
    // Check if write was called (it should have been for insertion)
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled();
  });
});
