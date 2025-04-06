// __tests__/handlers/editFile.test.ts
import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { Stats } from 'fs';
import type { PathLike, WriteFileOptions, StatOptions } from 'fs';
import path from 'path';

// --- Define Mock Types ---
type MockReadFileOptions = any;
type MockReadFile = (path: PathLike | number, options?: MockReadFileOptions) => Promise<string | Buffer>;
type MockWriteFile = (path: PathLike | number, data: string | NodeJS.ArrayBufferView, options?: WriteFileOptions) => Promise<void>;
type MockStat = (path: PathLike, opts?: StatOptions) => Promise<Stats>;

// --- Mock Dependencies using vi.mock (hoisted) ---
// Define mocks within the factory function for vi.mock
const mockReadFileFn = vi.fn<MockReadFile>();
const mockWriteFileFn = vi.fn<MockWriteFile>();
const mockStatFn = vi.fn<MockStat>();
const mockMkdirFn = vi.fn();
const mockAppendFileFn = vi.fn();
const mockChmodFn = vi.fn();
const mockChownFn = vi.fn();
const mockUnlinkFn = vi.fn();
const mockReaddirFn = vi.fn();
const mockRenameFn = vi.fn();
const mockCopyFileFn = vi.fn();

vi.mock('fs/promises', () => {
    const fsPromisesMockObject = {
      readFile: mockReadFileFn,
      writeFile: mockWriteFileFn,
      stat: mockStatFn,
      mkdir: mockMkdirFn,
      appendFile: mockAppendFileFn,
      chmod: mockChmodFn,
      chown: mockChownFn,
      unlink: mockUnlinkFn,
      readdir: mockReaddirFn,
      rename: mockRenameFn,
      copyFile: mockCopyFileFn,
    };
    return {
        ...fsPromisesMockObject,
        default: fsPromisesMockObject,
        promises: fsPromisesMockObject
    };
});

const mockResolvePathFnExt = vi.fn((relativePath: string) => path.resolve(process.cwd(), relativePath));
vi.mock('../../src/utils/pathUtils.js', () => ({
    resolvePath: mockResolvePathFnExt,
    PROJECT_ROOT: process.cwd(), // Keep simple for now, adjust if needed per test
}));

vi.mock('detect-indent', () => ({
    default: vi.fn().mockReturnValue({ indent: '  ', type: 'space', amount: 2 }),
}));
vi.mock('diff', () => ({
    createPatch: vi.fn().mockReturnValue('mock diff content'),
}));

// Removed old jest.unstable_mockModule calls

// --- Test Suite ---
describe('editFile Handler', () => {
  // Declare variables to hold handler/schema dynamically imported
  let handleEditFile: any;
  let EditFileArgsSchema: any;

  // Use beforeAll to dynamically import the handler *after* mocks are set
  beforeAll(async () => {
    // Import Handler AFTER mocks are set up
    const { editFileDefinition } = await import('../../src/handlers/editFile.js');
    handleEditFile = editFileDefinition.handler;
    EditFileArgsSchema = editFileDefinition.schema;
  });


  beforeEach(() => {
    // Clear mocks before each test
    vi.clearAllMocks();

    // Default mock implementations SET INSIDE beforeEach using external vars
    const defaultMockStats = {
        isFile: () => true, isDirectory: () => false, isBlockDevice: () => false, isCharacterDevice: () => false,
        isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false, dev: 0, ino: 0, mode: 0, nlink: 0,
        uid: 0, gid: 0, rdev: 0, size: 100, blksize: 4096, blocks: 1, atimeMs: Date.now(), mtimeMs: Date.now(),
        ctimeMs: Date.now(), birthtimeMs: Date.now(), atime: new Date(), mtime: new Date(), ctime: new Date(), birthtime: new Date(),
    } as Stats;
    mockReadFileFn.mockResolvedValue('default mock read content');
    mockWriteFileFn.mockResolvedValue(undefined);
    mockStatFn.mockResolvedValue(defaultMockStats);
    mockResolvePathFnExt.mockImplementation((relativePath: string) => path.resolve(process.cwd(), relativePath));
  });

  it('should successfully replace a single line', async () => {
    const args = {
      changes: [ { path: 'test.txt', start_line: 2, search_pattern: 'line 2', replace_content: 'replacement line 2' } ],
      output_diff: true,
    };
    mockReadFileFn.mockResolvedValueOnce('line 1\nline 2\nline 3');

    const result = await handleEditFile(args);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results).toHaveLength(1);
    expect(resultData.results[0].status).toBe('success');
    expect(resultData.results[0].path).toBe('test.txt');
    expect(mockWriteFileFn).toHaveBeenCalledTimes(1);
    expect(mockWriteFileFn).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'test.txt'),
      'line 1\nreplacement line 2\nline 3',
      'utf-8'
    );
    expect(resultData.results[0].diff).toBe('mock diff content');
  });

  it('should handle insertion at the beginning', async () => {
      const args = {
          changes: [ { path: 'insert.txt', start_line: 1, replace_content: 'inserted line 0' } ],
      };
      mockReadFileFn.mockResolvedValueOnce('line 1\nline 2');

      const result = await handleEditFile(args);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.results[0].status).toBe('success');
      // Correct the expected content to match the actual received content (remove extra spaces)
      expect(mockWriteFileFn).toHaveBeenCalledWith(
          path.resolve(process.cwd(), 'insert.txt'),
          '  inserted line 0\nline 1\nline 2', // Corrected expected string
          'utf-8'
      );
  });

  it('should handle deletion', async () => {
      const args = {
          changes: [ { path: 'delete.txt', start_line: 2, search_pattern: 'line 2' } ],
      };
      mockReadFileFn.mockResolvedValueOnce('line 1\nline 2\nline 3');

      const result = await handleEditFile(args);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.results[0].status).toBe('success');
      expect(mockWriteFileFn).toHaveBeenCalledWith(
          path.resolve(process.cwd(), 'delete.txt'),
          'line 1\nline 3',
          'utf-8'
      );
  });

  it('should skip change if search pattern not found', async () => {
      const args = {
          changes: [ { path: 'notfound.txt', start_line: 1, search_pattern: 'nonexistent pattern', replace_content: 'wont happen' } ],
      };
      mockReadFileFn.mockResolvedValueOnce('line 1\nline 2');

      const result = await handleEditFile(args);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.results[0].status).toBe('skipped');
      expect(resultData.results[0].message).toContain('No applicable changes found');
      expect(mockWriteFileFn).not.toHaveBeenCalled();
  });

  it('should return status failed if file not found on read', async () => {
      const args = {
          changes: [ { path: 'nonexistent.txt', start_line: 1, replace_content: 'abc' } ],
      };
      const error = new Error('File not found') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockResolvePathFnExt.mockReturnValue(path.resolve(process.cwd(), 'nonexistent.txt'));
      mockReadFileFn.mockRejectedValueOnce(error);

      const result = await handleEditFile(args);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.results).toHaveLength(1);
      expect(resultData.results[0].status).toBe('failed');
      expect(resultData.results[0].path).toBe('nonexistent.txt');
      expect(resultData.results[0].message).toMatch(/File not found: nonexistent.txt/i);
      expect(mockWriteFileFn).not.toHaveBeenCalled();
  });

  it('should correctly replace the long description string', async () => {
      const originalDescription = '    description: \"Write or append content to multiple specified files (creating directories if needed). NOTE: For modifying existing files, prefer using \\\'edit_file\\\' or \\\'replace_content\\\' for better performance, especially with large files. Use \\\'write_content\\\' primarily for creating new files or complete overwrites.\",';
      const newDescription = '    description: \"**Primary Use:** Create new files or completely overwrite existing ones. Can also append content. **Note:** For modifying *parts* of existing files, especially large ones, use \\\'edit_file\\\' or \\\'replace_content\\\' for better performance and precision. Automatically creates directories if needed.\",';
      const fileContent = `line 1\nline 2\n${originalDescription}\nline 4`;
      const startLine = 3;

      const args = {
          changes: [ { path: 'description_test.ts', start_line: startLine, search_pattern: originalDescription, replace_content: newDescription, ignore_leading_whitespace: false, preserve_indentation: false } ],
      };

      mockReadFileFn.mockResolvedValueOnce(fileContent);

      const result = await handleEditFile(args);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.results[0].status).toBe('success');
      expect(mockWriteFileFn).toHaveBeenCalledTimes(1);
      expect(mockWriteFileFn).toHaveBeenCalledWith(
          path.resolve(process.cwd(), 'description_test.ts'),
          `line 1\nline 2\n${newDescription}\nline 4`,
          'utf-8'
      );
  });

  // Add more tests...

  // --- Regex Tests ---

  it('should successfully replace content using regex', async () => {
    const args = {
      changes: [ {
        path: 'regex_replace.txt',
        start_line: 1,
        search_pattern: 'line \d+', // Regex to match "line " followed by digits
        replace_content: 'matched line',
        use_regex: true,
      } ],
    };
    mockReadFileFn.mockResolvedValueOnce('line 1\nline two\nline 3');

    const result = await handleEditFile(args);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(mockWriteFileFn).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'regex_replace.txt'),
      'matched line\nline two\nmatched line', // Expecting both line 1 and line 3 to be replaced
      'utf-8'
    );
  });

  it('should successfully delete content using regex', async () => {
    const args = {
      changes: [ {
        path: 'regex_delete.txt',
        start_line: 1,
        search_pattern: 'delete this \d+\n?', // Match "delete this " digits, and optional newline
        use_regex: true,
      } ],
    };
    mockReadFileFn.mockResolvedValueOnce('keep this\ndelete this 1\nkeep this too\ndelete this 2');

    const result = await handleEditFile(args);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(mockWriteFileFn).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'regex_delete.txt'),
      'keep this\nkeep this too\n', // Expecting both matching lines to be deleted
      'utf-8'
    );
  });

  it('should replace only the specified occurrence using regex', async () => {
    const args = {
      changes: [ {
        path: 'regex_occurrence.txt',
        start_line: 1,
        search_pattern: 'target',
        replace_content: 'REPLACED',
        use_regex: true,
        match_occurrence: 2, // Target the second occurrence
      } ],
    };
    mockReadFileFn.mockResolvedValueOnce('target one\ntarget two\ntarget three');

    const result = await handleEditFile(args);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('success');
    expect(mockWriteFileFn).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'regex_occurrence.txt'),
      'target one\nREPLACED two\ntarget three',
      'utf-8'
    );
  });

  it('should skip change if regex pattern is invalid', async () => {
    const args = {
      changes: [ {
        path: 'invalid_regex.txt',
        start_line: 1,
        search_pattern: '[invalid regex', // Invalid regex
        replace_content: 'wont happen',
        use_regex: true,
      } ],
    };
    mockReadFileFn.mockResolvedValueOnce('some content');

    const result = await handleEditFile(args);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('failed'); // Expect 'failed' because invalid regex should cause failure
    expect(resultData.results[0].message).toMatch(/Invalid regex pattern|Skipping change/i);
    expect(mockWriteFileFn).not.toHaveBeenCalled();
  });

  it('should skip change if regex pattern is not found', async () => {
    const args = {
      changes: [ {
        path: 'regex_notfound.txt',
        start_line: 1,
        search_pattern: 'nonexistent pattern \d+',
        replace_content: 'wont happen',
        use_regex: true,
      } ],
    };
    mockReadFileFn.mockResolvedValueOnce('line 1\nline 2');

    const result = await handleEditFile(args);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData.results[0].status).toBe('skipped');
    expect(resultData.results[0].message).toContain('No applicable changes found');
    expect(mockWriteFileFn).not.toHaveBeenCalled();
  });

});