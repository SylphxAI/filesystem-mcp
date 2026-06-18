import { describe, it, expect, vi } from 'vitest';
import { handleApplyDiff, handleApplyDiffInternal } from '../../src/handlers/apply-diff.js';
import type { FileSystemDependencies } from '../../src/handlers/common.js';

// Covers the diff-application failure path (applyDiffsToContent throws) and the
// ENOENT-vs-generic context branch in handleApplyDiffInternal.

function makeDeps(overrides: Partial<FileSystemDependencies> = {}): FileSystemDependencies {
  return {
    path: { resolve: (...parts: string[]) => parts.join('/') },
    writeFile: vi.fn().mockResolvedValue(undefined) as never,
    readFile: vi.fn().mockResolvedValue('line one\nline two\n') as never,
    projectRoot: '/project',
    ...overrides,
  };
}

describe('apply-diff error branches', () => {
  it('reports "File not found" context when the formatted error mentions ENOENT', async () => {
    // The context branch keys off the *formatted* message containing 'ENOENT'.
    // formatFileProcessingError only echoes the original message for codes it
    // doesn't special-case, so an uncoded error whose message says ENOENT lands
    // in the fallthrough and the message carries the word through.
    const deps = makeDeps({
      writeFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')) as never,
    });

    const result = await handleApplyDiffInternal('nested/missing.txt', 'data', deps);

    expect(result.success).toBe(false);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].context).toBe('File not found');
    expect(result.results[0].error).toContain('ENOENT');
  });

  it('reports "Error writing file" context for an error without an ENOENT mention', async () => {
    const deps = makeDeps({
      writeFile: vi.fn().mockRejectedValue(new Error('permission denied')) as never,
    });

    const result = await handleApplyDiffInternal('a.txt', 'data', deps);

    expect(result.results[0].success).toBe(false);
    expect(result.results[0].context).toBe('Error writing file');
  });

  it('handles a non-Error write rejection with the unknown-error message', async () => {
    const deps = makeDeps({ writeFile: vi.fn().mockRejectedValue('boom') as never });

    const result = await handleApplyDiffInternal('a.txt', 'data', deps);

    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toMatch(/Unknown error occurred while processing a.txt/);
  });

  it('propagates a diff-application failure when the search block does not match', async () => {
    // The real applyDiffsToFileContent rejects a search that isn't present at
    // the given lines, so applyDiffsToContent throws and the failure surfaces.
    const deps = makeDeps({ readFile: vi.fn().mockResolvedValue('actual content\n') as never });

    await expect(
      handleApplyDiff(
        [
          {
            path: 'a.txt',
            diffs: [
              {
                search: 'totally different text',
                replace: 'x',
                start_line: 1,
                end_line: 1,
              },
            ],
          },
        ],
        deps,
      ),
    ).rejects.toThrow();
  });

  it('applies a matching diff across the dependency boundary and writes the result', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      readFile: vi.fn().mockResolvedValue('alpha\nbeta\n') as never,
      writeFile: writeFile as never,
    });

    const result = await handleApplyDiff(
      [
        {
          path: 'a.txt',
          diffs: [{ search: 'beta', replace: 'gamma', start_line: 2, end_line: 2 }],
        },
      ],
      deps,
    );

    expect(result.success).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(1);
    const written = writeFile.mock.calls[0][1] as string;
    expect(written).toContain('gamma');
  });
});
