import { describe, it, expect } from 'vitest';
import { formatFileProcessingError } from '../../src/utils/error-utils';

describe('errorUtils', () => {
  describe('formatFileProcessingError', () => {
    it('should handle ENOENT errors', () => {
      const error = new Error('Not found');
      (error as any).code = 'ENOENT';
      const result = formatFileProcessingError(error, '/path', 'file.txt', '/project');
      expect(result).toContain('File not found at resolved path');
    });

    it('should handle EACCES errors', () => {
      const error = new Error('Permission denied');
      (error as any).code = 'EACCES';
      const result = formatFileProcessingError(error, '/path', 'file.txt', '/project');
      expect(result).toContain('Permission denied for file');
    });

    it('should handle generic Error objects', () => {
      const result = formatFileProcessingError(
        new Error('Test error'),
        '/path',
        'file.txt',
        '/project',
      );
      expect(result).toContain('Failed to process file file.txt: Test error');
    });

    it('should handle non-Error objects', () => {
      const result = formatFileProcessingError('string error', '/path', 'file.txt', '/project');
      expect(result).toContain('Failed to process file file.txt: string error');
    });

    it('should handle null/undefined errors', () => {
      const result1 = formatFileProcessingError(null, '/path', 'file.txt', '/project');
      expect(result1).toContain('Failed to process file file.txt: null');

      const result2 = formatFileProcessingError(undefined, '/path', 'file.txt', '/project');
      expect(result2).toContain('Failed to process file file.txt: undefined');
    });
  });
});
