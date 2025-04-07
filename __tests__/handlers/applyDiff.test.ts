import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs, type PathLike } from 'fs'; // Import PathLike
import path from 'path';
// Import internal handler and dependency type
import {
  handleApplyDiffInternal,
  type ApplyDiffDeps,
} from '../../src/handlers/applyDiff';
import {
  createTemporaryFilesystem,
  cleanupTemporaryFilesystem,
} from '../testUtils';
import {
  applyDiffInputSchema,
  type ApplyDiffInput,
  type DiffApplyResult,
} from '../../src/schemas/applyDiffSchema';
import { resolvePath as resolvePathUtil } from '../../src/utils/pathUtils'; // Import real resolvePath

// No longer mocking fs globally
// No longer mocking pathUtils globally

describe('applyDiff Handler', () => {
  let testDir: string;
  let projectRoot: string;
  let mockDeps: ApplyDiffDeps;
  let mockReadFile: vi.Mock;
  let mockWriteFile: vi.Mock;

  beforeEach(async () => {
    testDir = await createTemporaryFilesystem({});
    projectRoot = testDir;

    // Create mocks for dependencies
    mockReadFile = vi.fn();
    mockWriteFile = vi.fn();

    // Default mock implementations (can be overridden in tests)
    mockReadFile.mockImplementation(async (p: PathLike) => {
      const err = new Error(
        `ENOENT: no such file or directory, open '${p.toString()}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    mockWriteFile.mockResolvedValue(undefined);

    // Create mock dependencies object
    mockDeps = {
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      // Use real resolvePathUtil but bind it to projectRoot for testing context
      resolvePath: (relativePath: string) =>
        resolvePathUtil(relativePath, projectRoot),
      projectRoot: projectRoot,
    };

    // No need to mock process.cwd() anymore as projectRoot is injected
    // vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(testDir);
    vi.restoreAllMocks(); // Restore any potential spies if added later
  });

  // Helper remains the same, but we'll pass args to internal handler
  const createArgs = (changes: ApplyDiffInput['changes']): ApplyDiffInput => ({
    changes,
  });

  it('should apply a single diff block successfully', async () => {
    const filePath = 'file1.txt';
    const resolvedFilePath = path.join(projectRoot, filePath);
    const initialContent = 'Line 1\nLine 2\nLine 3';
    const expectedContent = 'Line One\nLine 2\nLine 3';
    mockReadFile.mockImplementation(async (p: PathLike) => {
      if (path.normalize(p.toString()) === resolvedFilePath)
        return initialContent;
      const err = new Error(
        `ENOENT: no such file or directory, open '${p.toString()}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const args = createArgs([
      {
        path: filePath,
        diffs: [
          { search: 'Line 1', replace: 'Line One', start_line: 1, end_line: 1 },
        ],
      },
    ]);
    // Call internal handler directly with mock dependencies
    const responseData = await handleApplyDiffInternal(mockDeps, args);

    const results = responseData.results as DiffApplyResult[];
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ path: filePath, success: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      resolvedFilePath,
      expectedContent,
      'utf-8',
    );
  });

  it('should apply multiple diff blocks successfully (bottom-up)', async () => {
    const filePath = 'multi.txt';
    const resolvedFilePath = path.join(projectRoot, filePath);
    const initialContent = 'First line\nSecond line\nThird line';
    const expectedContent = 'FIRST line\nSecond ROW\nThird line';
    mockReadFile.mockImplementation(async (p: PathLike) => {
      if (path.normalize(p.toString()) === resolvedFilePath)
        return initialContent;
      const err = new Error(
        `ENOENT: no such file or directory, open '${p.toString()}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const args = createArgs([
      {
        path: filePath,
        diffs: [
          {
            search: 'First line',
            replace: 'FIRST line',
            start_line: 1,
            end_line: 1,
          },
          {
            search: 'Second line',
            replace: 'Second ROW',
            start_line: 2,
            end_line: 2,
          },
        ],
      },
    ]);
    const responseData = await handleApplyDiffInternal(mockDeps, args);

    const results = responseData.results as DiffApplyResult[];
    expect(results[0]).toEqual({ path: filePath, success: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      resolvedFilePath,
      expectedContent,
      'utf-8',
    );
  });

  it('should handle multiple files successfully', async () => {
    const file1Path = 'file1.txt';
    const file2Path = 'file2.txt';
    const resolvedFile1Path = path.join(projectRoot, file1Path);
    const resolvedFile2Path = path.join(projectRoot, file2Path);
    const initialContent1 = 'Content A';
    const initialContent2 = 'Content B';
    const expectedContent1 = 'Content Alpha';
    const expectedContent2 = 'Content Bravo';

    mockReadFile.mockImplementation(async (p: PathLike) => {
      const pathString = p?.toString();
      if (!pathString) {
        const err = new Error('ENOENT: Path missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      const resolvedP = path.normalize(pathString);
      if (resolvedP === resolvedFile1Path) return initialContent1;
      if (resolvedP === resolvedFile2Path) return initialContent2;
      const err = new Error(
        `ENOENT: no such file or directory, open '${pathString}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const args = createArgs([
      {
        path: file1Path,
        diffs: [
          {
            search: 'Content A',
            replace: 'Content Alpha',
            start_line: 1,
            end_line: 1,
          },
        ],
      },
      {
        path: file2Path,
        diffs: [
          {
            search: 'Content B',
            replace: 'Content Bravo',
            start_line: 1,
            end_line: 1,
          },
        ],
      },
    ]);
    const responseData = await handleApplyDiffInternal(mockDeps, args);

    const results = responseData.results as DiffApplyResult[];
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: file1Path, success: true }),
        expect.objectContaining({ path: file2Path, success: true }),
      ]),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      resolvedFile1Path,
      expectedContent1,
      'utf-8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      resolvedFile2Path,
      expectedContent2,
      'utf-8',
    );
  });

  it('should fail and not write if search content mismatch', async () => {
    const filePath = 'mismatch.txt';
    const resolvedFilePath = path.join(projectRoot, filePath);
    const initialContent = 'Actual Line 1\nActual Line 2';
    mockReadFile.mockImplementation(async (p: PathLike) => {
      const pathString = p?.toString();
      if (pathString && path.normalize(pathString) === resolvedFilePath)
        return initialContent;
      const err = new Error(
        `ENOENT: no such file or directory, open '${pathString ?? 'undefined'}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const args = createArgs([
      {
        path: filePath,
        diffs: [
          {
            search: 'Expected Line 1',
            replace: 'New Line 1',
            start_line: 1,
            end_line: 1,
          },
        ],
      },
    ]);
    const responseData = await handleApplyDiffInternal(mockDeps, args);

    const results = responseData.results as DiffApplyResult[];
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].path).toBe(filePath);
    expect(results[0].error).toContain('Content mismatch at lines 1-1');
    expect(results[0].context).toContain('--- EXPECTED (Search Block) ---');
    expect(results[0].context).toContain('Expected Line 1');
    expect(results[0].context).toContain('--- ACTUAL (Lines 1-1) ---');
    expect(results[0].context).toContain('Actual Line 1');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should fail and not write if any diff block fails (atomicity)', async () => {
    const filePath = 'atomic.txt';
    const resolvedFilePath = path.join(projectRoot, filePath);
    const initialContent = 'Line 1\nLine 2\nLine 3';
    mockReadFile.mockImplementation(async (p: PathLike) => {
      const pathString = p?.toString();
      if (pathString && path.normalize(pathString) === resolvedFilePath)
        return initialContent;
      const err = new Error(
        `ENOENT: no such file or directory, open '${pathString ?? 'undefined'}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const args = createArgs([
      {
        path: filePath,
        diffs: [
          { search: 'Line 1', replace: 'Line One', start_line: 1, end_line: 1 },
          {
            search: 'Wrong Line 2',
            replace: 'Line Two',
            start_line: 2,
            end_line: 2,
          },
        ],
      },
    ]);
    const responseData = await handleApplyDiffInternal(mockDeps, args);

    const results = responseData.results as DiffApplyResult[];
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].path).toBe(filePath);
    expect(results[0].error).toContain('Content mismatch at lines 2-2');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should fail if line numbers are invalid', async () => {
    const filePath = 'invalid_lines.txt';
    const resolvedFilePath = path.join(projectRoot, filePath);
    const initialContent = 'Line 1';
    mockReadFile.mockImplementation(async (p: PathLike) => {
      const pathString = p?.toString();
      if (pathString && path.normalize(pathString) === resolvedFilePath)
        return initialContent;
      const err = new Error(
        `ENOENT: no such file or directory, open '${pathString ?? 'undefined'}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const args = createArgs([
      {
        path: filePath,
        diffs: [
          { search: 'Line 1', replace: 'New Line', start_line: 1, end_line: 2 },
        ],
      },
    ]);
    const responseData = await handleApplyDiffInternal(mockDeps, args);
    const results = responseData.results as DiffApplyResult[];
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('Invalid line numbers [1-2]');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should fail if file not found (ENOENT)', async () => {
    const filePath = 'not_found.txt';
    const resolvedFilePath = path.join(projectRoot, filePath);
    mockReadFile.mockImplementation(async (p: PathLike) => {
      const pathString = p?.toString();
      const err = new Error(
        `ENOENT: no such file or directory, open '${pathString ?? 'undefined'}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const args = createArgs([
      {
        path: filePath,
        diffs: [{ search: 'a', replace: 'b', start_line: 1, end_line: 1 }],
      },
    ]);
    const responseData = await handleApplyDiffInternal(mockDeps, args);
    const results = responseData.results as DiffApplyResult[];
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/File not found at resolved path:/);
    expect(results[0].error).toContain(resolvedFilePath);
    expect(results[0].error).toContain(`Original path: ${filePath}`);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should fail if permission denied (EACCES)', async () => {
    const filePath = 'permission_denied.txt';
    const resolvedFilePath = path.join(projectRoot, filePath);
    const permissionError = new Error(
      'EACCES: permission denied',
    ) as NodeJS.ErrnoException;
    permissionError.code = 'EACCES';
    mockReadFile.mockImplementation(async (p: PathLike) => {
      const pathString = p?.toString();
      if (pathString && path.normalize(pathString) === resolvedFilePath)
        throw permissionError;
      const err = new Error(
        `ENOENT: no such file or directory, open '${pathString ?? 'undefined'}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const args = createArgs([
      {
        path: filePath,
        diffs: [{ search: 'a', replace: 'b', start_line: 1, end_line: 1 }],
      },
    ]);
    const responseData = await handleApplyDiffInternal(mockDeps, args);
    const results = responseData.results as DiffApplyResult[];
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/Permission denied for file:/);
    expect(results[0].error).toContain(resolvedFilePath);
    expect(results[0].error).toContain(`Original path: ${filePath}`);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should handle mixed success and failure across files', async () => {
    const successPath = 'success.txt';
    const failurePath = 'failure.txt';
    const resolvedSuccessPath = path.join(projectRoot, successPath);
    const resolvedFailurePath = path.join(projectRoot, failurePath);
    const initialSuccess = 'Good content';
    const initialFailure = 'Bad content';
    const expectedSuccess = 'Excellent content';

    mockReadFile.mockImplementation(async (p: PathLike) => {
      const pathString = p?.toString();
      if (!pathString) {
        const err = new Error('ENOENT: Path missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      const resolvedP = path.normalize(pathString);
      if (resolvedP === resolvedSuccessPath) return initialSuccess;
      if (resolvedP === resolvedFailurePath) return initialFailure;
      const err = new Error(
        `ENOENT: no such file or directory, open '${pathString}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const args = createArgs([
      {
        path: successPath,
        diffs: [
          {
            search: 'Good content',
            replace: 'Excellent content',
            start_line: 1,
            end_line: 1,
          },
        ],
      },
      {
        path: failurePath,
        diffs: [
          {
            search: 'Wrong content',
            replace: 'Fixed content',
            start_line: 1,
            end_line: 1,
          },
        ],
      }, // Mismatch
    ]);
    const responseData = await handleApplyDiffInternal(mockDeps, args);
    const results = responseData.results as DiffApplyResult[];
    expect(results).toHaveLength(2);

    const successResult = results.find((r) => r.path === successPath);
    const failureResult = results.find((r) => r.path === failurePath);

    expect(successResult).toEqual({ path: successPath, success: true });
    expect(failureResult?.success).toBe(false);
    expect(failureResult?.error).toContain('Content mismatch');

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      resolvedSuccessPath,
      expectedSuccess,
      'utf-8',
    );
    expect(mockWriteFile).not.toHaveBeenCalledWith(
      resolvedFailurePath,
      expect.anything(),
      expect.anything(),
    );
  });

  it('should reject request if a path appears multiple times', async () => {
    const filePath = 'duplicate.txt';
    const input: ApplyDiffInput = {
      changes: [
        {
          path: filePath,
          diffs: [{ search: 'a', replace: 'b', start_line: 1, end_line: 1 }],
        },
        {
          path: filePath,
          diffs: [{ search: 'c', replace: 'd', start_line: 1, end_line: 1 }],
        },
      ],
    };

    const validationResult = applyDiffInputSchema.safeParse(input);
    expect(validationResult.success).toBe(false);
    expect(validationResult.error?.errors[0].message).toContain(
      'Each file path must appear only once',
    );
  });
});
