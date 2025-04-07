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
const { handleReplaceContentInternal } = await import(
  '../../src/handlers/replaceContent.js'
);
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

describe('handleReplaceContent Success Scenarios', () => {
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
});
