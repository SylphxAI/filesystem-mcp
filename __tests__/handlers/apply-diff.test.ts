import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleApplyDiffInternal, handleApplyDiff } from '../../src/handlers/apply-diff';
import type { FileDiff } from '../../src/schemas/apply-diff-schema';

describe('applyDiff Handler', () => {
  const mockDeps = {
    path: {
      resolve: vi.fn((root, path) => `${root}/${path}`),
    },
    writeFile: vi.fn(),
    readFile: vi.fn().mockResolvedValue(''),
    projectRoot: '/project',
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('handleApplyDiffInternal', () => {
    it('should return success on successful write', async () => {
      mockDeps.writeFile.mockResolvedValue('');
      const result = await handleApplyDiffInternal('file.txt', 'content', mockDeps);
      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);
    });

    it('should handle write errors', async () => {
      mockDeps.writeFile.mockRejectedValue(new Error('Write failed'));
      const result = await handleApplyDiffInternal('file.txt', 'content', mockDeps);
      expect(result.success).toBe(false);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toBeDefined();
    });
  });

  describe('handleApplyDiff', () => {
    it('should handle empty changes', async () => {
      const result = await handleApplyDiff([], mockDeps);
      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
    });

    it('should process multiple files', async () => {
      mockDeps.writeFile.mockResolvedValue('');
      const changes: FileDiff[] = [
        { path: 'file1.txt', diffs: [] },
        { path: 'file2.txt', diffs: [] },
      ];
      const result = await handleApplyDiff(changes, mockDeps);
      expect(result.results.length).toBe(2);
      expect(result.success).toBe(true);
    });

    it('should handle mixed success/failure', async () => {
      mockDeps.writeFile.mockResolvedValueOnce('').mockRejectedValueOnce(new Error('Failed'));
      const changes: FileDiff[] = [
        { path: 'file1.txt', diffs: [] },
        { path: 'file2.txt', diffs: [] },
      ];
      const result = await handleApplyDiff(changes, mockDeps);
      expect(result.results.length).toBe(2);
      expect(result.success).toBe(false);
    });
  });
});
