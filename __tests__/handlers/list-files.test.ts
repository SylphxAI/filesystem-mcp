// __tests__/handlers/list-files.test.ts
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { McpError, ErrorCode } from '../../src/types/mcp-types.js';
import type { PathLike, StatOptions } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

import type { ListFilesDependencies } from '../../src/handlers/list-files';
import { handleListFilesFunc } from '../../src/handlers/list-files';

// --- Test Suite ---
describe('listFiles Handler (Integration)', () => {
  let tempTestDir = ''; // To store the path of the temporary directory

  let mockDependencies: ListFilesDependencies;
  // Declare mockGlob here so it's accessible in beforeEach and tests
  let mockGlob: Mock;

  beforeEach(async () => {
    // Create temp directory
    tempTestDir = await fsPromises.mkdtemp(path.join(process.cwd(), 'temp-test-listFiles-'));

    // --- Create Mock Dependencies ---
    const fsModule = await vi.importActual<typeof import('fs')>('fs');
    const actualFsPromises = fsModule.promises;
    const actualPath = await vi.importActual<typeof path>('path');
    const actualStatsUtils = await vi.importActual<typeof import('../../src/utils/stats-utils')>(
      '../../src/utils/stats-utils.js',
    );

    // Create mock function directly
    mockGlob = vi.fn(); // Assign to the variable declared outside

    // Import the *actual* glob module to get the real implementation
    const actualGlobModule = await vi.importActual<typeof import('glob')>('glob');
    // Set default implementation on the mock function
    mockGlob.mockImplementation(actualGlobModule.glob);

    mockDependencies = {
      // Use actual implementations by default
      stat: vi.fn().mockImplementation(actualFsPromises.stat),
      readdir: vi.fn().mockImplementation(actualFsPromises.readdir),
      glob: mockGlob, // Assign our created mock function
      // Mock resolvePath to behave like the real one relative to PROJECT_ROOT
      resolvePath: vi.fn().mockImplementation((relativePath: string): string => {
        const root = process.cwd(); // Use actual project root
        if (actualPath.isAbsolute(relativePath)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Mocked Absolute paths are not allowed for ${relativePath}`,
          );
        }
        // The real resolvePath returns an absolute path, let's keep that behavior
        const absolutePath = actualPath.resolve(root, relativePath);
        // The real resolvePath also checks traversal against PROJECT_ROOT
        if (!absolutePath.startsWith(root) && absolutePath !== root) {
          // Allow resolving to root itself
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Mocked Path traversal detected for ${relativePath}`,
          );
        }
        return absolutePath;
      }),
      PROJECT_ROOT: process.cwd(), // Use actual project root for relative path calculations
      formatStats: actualStatsUtils.formatStats, // Use actual formatStats
      path: {
        // Use actual path functions
        join: actualPath.join,
        dirname: actualPath.dirname,
        resolve: actualPath.resolve,
        relative: actualPath.relative,
        basename: actualPath.basename,
      },
    };
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempTestDir) {
      try {
        await fsPromises.rm(tempTestDir, { recursive: true, force: true });
        tempTestDir = '';
      } catch {
        // Failed to remove temp directory - ignore
      }
    }
    // Clear all mocks (including implementations set within tests)
    vi.clearAllMocks();
  });

  it('should list files non-recursively without stats', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir); // Get relative path for handler arg

    // Create test files/dirs inside tempTestDir
    await fsPromises.writeFile(path.join(tempTestDir, 'file1.txt'), 'content1');
    await fsPromises.mkdir(path.join(tempTestDir!, 'subdir'));
    await fsPromises.writeFile(path.join(tempTestDir!, 'subdir', 'nested.txt'), 'content2');

    // No need to set implementation here, beforeEach sets the default (actual)

    const args = {
      path: testDirPathRelative,
      recursive: false,
      include_stats: false,
    };

    // Call the core function with mock dependencies
    const result = await handleListFilesFunc(mockDependencies, args); // Use the core function
    const resultData = JSON.parse(result.content[0].text);

    // Paths should be relative to the project root
    expect(resultData).toEqual(
      expect.arrayContaining([
        `${testDirPathRelative}/file1.txt`.replaceAll('\\', '/'),
        `${testDirPathRelative}/subdir/`.replaceAll('\\', '/'),
      ]),
    );
    expect(resultData).toHaveLength(2);
  });

  it('should list files recursively with stats using glob', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir!);
    const subDirPath = path.join(tempTestDir, 'nested');
    const fileAPath = path.join(tempTestDir, 'fileA.ts');
    const fileBPath = path.join(subDirPath, 'fileB.js');

    // Create structure
    await fsPromises.mkdir(subDirPath);
    await fsPromises.writeFile(fileAPath, '// content A');
    await fsPromises.writeFile(fileBPath, '// content B');

    // No need to set implementation here, beforeEach sets the default (actual)

    const args = {
      path: testDirPathRelative,
      recursive: true,
      include_stats: true,
    };

    // Call the core function with mock dependencies
    const result = await handleListFilesFunc(mockDependencies, args); // Use the core function
    const resultData = JSON.parse(result.content[0].text);

    // Updated expectation to include the directory and check size correctly
    expect(resultData).toHaveLength(3);
    // Check against the actual structure returned by formatStats
    expect(resultData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `${testDirPathRelative}/fileA.ts`.replaceAll('\\', '/'),
          stats: expect.objectContaining({
            isFile: true,
            isDirectory: false,
            size: 12,
          }),
        }),
        expect.objectContaining({
          path: `${testDirPathRelative}/nested/`.replaceAll('\\', '/'),
          stats: expect.objectContaining({ isFile: false, isDirectory: true }),
        }), // Directories might have size 0 or vary
        expect.objectContaining({
          path: `${testDirPathRelative}/nested/fileB.js`.replaceAll('\\', '/'),
          stats: expect.objectContaining({
            isFile: true,
            isDirectory: false,
            size: 12,
          }),
        }),
      ]),
    );
  });

  it('should return stats for a single file path', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const targetFilePath = path.join(tempTestDir, 'singleFile.txt');
    const targetFileRelativePath = path.relative(process.cwd(), targetFilePath);
    await fsPromises.writeFile(targetFilePath, 'hello');

    // No need to set glob implementation, not called for single files

    const args = { path: targetFileRelativePath };

    // Call the core function with mock dependencies
    const result = await handleListFilesFunc(mockDependencies, args); // Use the core function
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData).not.toBeInstanceOf(Array);
    // Updated expectation to only check core properties
    expect(resultData).toEqual(
      expect.objectContaining({
        path: targetFileRelativePath.replaceAll('\\', '/'),
        isFile: true,
        isDirectory: false,
        size: 5,
      }),
    );
    expect(resultData).toHaveProperty('mtime');
    expect(resultData).toHaveProperty('mode');
  });

  it('should throw McpError if path does not exist', async () => {
    const args = { path: 'nonexistent-dir/nonexistent-file.txt' };

    // Call the core function with mock dependencies
    // Instead of checking instanceof, check for specific properties
    await expect(handleListFilesFunc(mockDependencies, args)).rejects.toMatchObject({
      name: 'McpError',
      code: ErrorCode.InvalidRequest,
      message: expect.stringContaining('Path not found: nonexistent-dir/nonexistent-file.txt'),
    });
  });

  it('should handle errors during glob execution', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir!);

    // Configure mockGlob to throw an error for this test
    const mockError = new Error('Mocked glob error');
    // Get the mock function from dependencies and set implementation
    const currentMockGlob = mockDependencies.glob as Mock; // Use the one assigned in beforeEach
    currentMockGlob.mockImplementation(async () => {
      throw mockError;
    });

    const args = {
      path: testDirPathRelative,
      recursive: true,
      include_stats: true,
    };

    // Expect the handler to throw McpError
    // Instead of checking instanceof, check for specific properties
    await expect(handleListFilesFunc(mockDependencies, args)).rejects.toMatchObject({
      name: 'McpError',
      code: ErrorCode.InternalError, // Expect InternalError (-32603)
      message: expect.stringContaining('Failed to list files using glob: Mocked glob error'), // Match the new error message
    });

    // Check that our mockGlob was called
    expect(currentMockGlob).toHaveBeenCalled(); // Assert on the mock function

    // vi.clearAllMocks() in afterEach will reset the implementation for the next test
  });

  it('should handle unexpected errors during initial stat', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir);

    // Configure the stat mock within mockDependencies for this specific test
    const mockStat = mockDependencies.stat as Mock;
    mockStat.mockImplementation(async (p: PathLike, opts: StatOptions | undefined) => {
      // Compare absolute paths now since resolvePath returns absolute
      const targetAbsolutePath = mockDependencies.resolvePath(testDirPathRelative);
      if (p.toString() === targetAbsolutePath) {
        throw new Error('Mocked initial stat error');
      }
      // Delegate to actual stat if needed for other paths (unlikely here)
      const fsModule = await vi.importActual<typeof import('fs')>('fs');
      const actualFsPromises = fsModule.promises;
      return actualFsPromises.stat(p, opts);
    });

    const args = { path: testDirPathRelative };

    // Call the core function with mock dependencies
    // Instead of checking instanceof, check for specific properties
    await expect(handleListFilesFunc(mockDependencies, args)).rejects.toMatchObject({
      name: 'McpError',
      code: ErrorCode.InternalError,
      message: expect.stringContaining('Failed to process path: Mocked initial stat error'),
    });

    // No need to restore, afterEach clears mocks
  });

  it('should handle stat errors gracefully when include_stats is true', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir!);

    // Create files
    await fsPromises.writeFile(path.join(tempTestDir, 'file1.txt'), 'content1');
    await fsPromises.writeFile(path.join(tempTestDir, 'file2-stat-error.txt'), 'content2');

    // Configure the stat mock within mockDependencies for this specific test
    const mockStat = mockDependencies.stat as Mock;
    mockStat.mockImplementation(async (p: PathLike, opts: StatOptions | undefined) => {
      const pStr = p.toString();
      if (pStr.endsWith('file2-stat-error.txt')) {
        throw new Error('Mocked stat error');
      }
      // Delegate to actual stat for other paths
      const fsModule = await vi.importActual<typeof import('fs')>('fs');
      const actualFsPromises = fsModule.promises;
      return actualFsPromises.stat(p, opts);
    });

    const args = {
      path: testDirPathRelative,
      recursive: false,
      include_stats: true,
    };
    // Call the core function with mock dependencies
    const result = await handleListFilesFunc(mockDependencies, args); // Use the core function
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData).toHaveLength(2);
    const file1Result = resultData.find((r: { path: string }) => r.path.endsWith('file1.txt'));
    const file2Result = resultData.find((r: { path: string }) =>
      r.path.endsWith('file2-stat-error.txt'),
    );

    expect(file1Result).toBeDefined();
    expect(file1Result.stats).toBeDefined();
    expect(file1Result.stats.error).toBeUndefined();
    expect(file1Result.stats.isFile).toBe(true);

    expect(file2Result).toBeDefined();
    expect(file2Result.stats).toBeDefined();
    expect(file2Result.stats.error).toBeDefined();
    expect(file2Result.stats.error).toMatch(/Could not get stats: Mocked stat error/); // Restore original check

    // No need to restore, afterEach clears mocks
  });

  it('should list files recursively without stats', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir!);
    const subDirPath = path.join(tempTestDir, 'nested');
    const fileAPath = path.join(tempTestDir, 'fileA.ts');
    const fileBPath = path.join(subDirPath, 'fileB.js');

    // Create structure
    await fsPromises.mkdir(subDirPath);
    await fsPromises.writeFile(fileAPath, '// content A');
    await fsPromises.writeFile(fileBPath, '// content B');

    // No need to set implementation here, beforeEach sets the default (actual)

    const args = {
      path: testDirPathRelative,
      recursive: true,
      include_stats: false,
    }; // recursive: true, include_stats: false

    // Call the core function with mock dependencies
    const result = await handleListFilesFunc(mockDependencies, args); // Use the core function
    const resultData = JSON.parse(result.content[0].text); // Should be array of strings

    expect(resultData).toBeInstanceOf(Array);
    expect(resultData).toHaveLength(3);
    expect(resultData).toEqual(
      expect.arrayContaining([
        `${testDirPathRelative}/fileA.ts`.replaceAll('\\', '/'),
        `${testDirPathRelative}/nested/`.replaceAll('\\', '/'),
        `${testDirPathRelative}/nested/fileB.js`.replaceAll('\\', '/'),
      ]),
    );
    // Ensure no stats object is present
    expect(resultData[0]).not.toHaveProperty('stats');
  });

  it('should throw McpError for invalid argument types (Zod validation)', async () => {
    const args = { path: '.', recursive: 'not-a-boolean' }; // Invalid type for recursive

    // Call the core function with mock dependencies
    // Instead of checking instanceof, check for specific properties
    await expect(handleListFilesFunc(mockDependencies, args)).rejects.toMatchObject({
      name: 'McpError',
      code: ErrorCode.InvalidParams,
      message: expect.stringContaining('recursive (Expected boolean, received string)'), // Check Zod error message
    });
  });

  it('should handle stat errors gracefully during non-recursive list', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir!);

    // Create a file and a potentially problematic entry (like a broken symlink simulation)
    await fsPromises.writeFile(path.join(tempTestDir, 'goodFile.txt'), 'content');
    // We'll mock readdir to return an entry, and stat to fail for that entry
    const mockReaddir = mockDependencies.readdir as Mock;
    mockReaddir.mockResolvedValue([
      { name: 'goodFile.txt', isDirectory: () => false, isFile: () => true },
      {
        name: 'badEntry',
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
      }, // Simulate needing stat
    ]);

    const mockStat = mockDependencies.stat as Mock;
    mockStat.mockImplementation(async (p: PathLike) => {
      if (p.toString().endsWith('badEntry')) {
        throw new Error('Mocked stat failure for bad entry');
      }
      // Use actual stat for the good file
      const actualFsPromises = await vi.importActual<typeof fsPromises>('fs/promises');
      return actualFsPromises.stat(p);
    });

    const args = {
      path: testDirPathRelative,
      recursive: false,
      include_stats: false,
    };
    const result = await handleListFilesFunc(mockDependencies, args);
    const resultData = JSON.parse(result.content[0].text);

    // Should still list the good file, and the bad entry (assuming not a dir)
    expect(resultData).toHaveLength(2);
    expect(resultData).toEqual(
      expect.arrayContaining([
        `${testDirPathRelative}/goodFile.txt`.replaceAll('\\\\', '/'),
        `${testDirPathRelative}/badEntry`.replaceAll('\\\\', '/'), // Assumes not a dir if stat fails
      ]),
    );
  });

  it('should skip current directory entry (.) when returned by glob', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir!);
    await fsPromises.writeFile(path.join(tempTestDir, 'file1.txt'), 'content');

    // Mock glob to return '.' along with the file
    mockGlob.mockResolvedValue(['.', 'file1.txt']);

    const args = {
      path: testDirPathRelative,
      recursive: false,
      include_stats: true,
    }; // Use glob path
    const result = await handleListFilesFunc(mockDependencies, args);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData).toHaveLength(1); // '.' should be skipped
    expect(resultData[0].path).toBe(`${testDirPathRelative}/file1.txt`.replaceAll('\\\\', '/'));
  });

  it('should handle stat errors within glob results when include_stats is true', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir!);
    await fsPromises.writeFile(path.join(tempTestDir, 'file1.txt'), 'content');
    await fsPromises.writeFile(path.join(tempTestDir, 'file2-stat-error.txt'), 'content2');

    // Mock glob to return both files
    mockGlob.mockResolvedValue(['file1.txt', 'file2-stat-error.txt']);

    // Mock stat to fail for the second file
    const mockStat = mockDependencies.stat as Mock;
    mockStat.mockImplementation(async (p: PathLike) => {
      if (p.toString().endsWith('file2-stat-error.txt')) {
        throw new Error('Mocked stat error for glob');
      }
      const actualFsPromises = await vi.importActual<typeof fsPromises>('fs/promises');
      return actualFsPromises.stat(p);
    });

    const args = {
      path: testDirPathRelative,
      recursive: false,
      include_stats: true,
    }; // Use glob path
    const result = await handleListFilesFunc(mockDependencies, args);
    const resultData = JSON.parse(result.content[0].text);

    expect(resultData).toHaveLength(2);
    const file1Result = resultData.find((r: { path: string }) => r.path.endsWith('file1.txt'));
    const file2Result = resultData.find((r: { path: string }) =>
      r.path.endsWith('file2-stat-error.txt'),
    );

    expect(file1Result?.stats?.error).toBeUndefined();
    expect(file2Result?.stats?.error).toMatch(/Could not get stats: Mocked stat error for glob/);
  });

  it('should throw McpError if glob itself throws an error', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir!);
    const globError = new Error('Internal glob failure');
    mockGlob.mockRejectedValue(globError);

    const args = {
      path: testDirPathRelative,
      recursive: true,
      include_stats: true,
    }; // Use glob path

    // Instead of checking instanceof, check for specific properties
    await expect(handleListFilesFunc(mockDependencies, args)).rejects.toMatchObject({
      name: 'McpError',
      code: ErrorCode.InternalError,
      message: expect.stringContaining('Failed to list files using glob: Internal glob failure'),
    });
  });

  it('should handle generic errors during initial stat (non-ENOENT)', async () => {
    if (!tempTestDir) throw new Error('Temp directory not created');
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir!);
    const genericError = new Error('Generic stat failure');
    (mockDependencies.stat as Mock).mockRejectedValue(genericError);

    const args = { path: testDirPathRelative };

    // Instead of checking instanceof, check for specific properties
    await expect(handleListFilesFunc(mockDependencies, args)).rejects.toMatchObject({
      name: 'McpError',
      code: ErrorCode.InternalError,
      message: expect.stringContaining('Failed to process path: Generic stat failure'),
    });
  });

  // Add more tests..." // Keep this line for potential future additions
});
