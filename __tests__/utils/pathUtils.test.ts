import { describe, it, expect } from 'vitest'; // Removed vi, beforeEach
import path from 'path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// Import the functions and constant to test
import {
  resolvePath,
  PROJECT_ROOT, // Import the constant again
} from '../../src/utils/pathUtils.js';

// Define the mock root path for testing overrides
const MOCK_PROJECT_ROOT_OVERRIDE = path.resolve('/mock/project/root/override');
const ACTUAL_PROJECT_ROOT = process.cwd(); // Get the actual root for comparison

describe('pathUtils', () => {
  it('should have PROJECT_ROOT set to the actual process.cwd()', () => {
    // We can no longer easily mock this at the module level with current setup
    // So we test that it equals the actual cwd
    expect(PROJECT_ROOT).toBe(ACTUAL_PROJECT_ROOT);
  });

  describe('resolvePath', () => {
    // Test using the override parameter to simulate different roots
    it('should resolve a valid relative path using override root', () => {
      const userPath = 'src/file.ts';
      const expectedPath = path.resolve(MOCK_PROJECT_ROOT_OVERRIDE, userPath);
      // Pass the override root as the second argument
      expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toBe(
        expectedPath,
      );
    });

    it('should resolve a valid relative path using default PROJECT_ROOT when override is not provided', () => {
      const userPath = 'src/file.ts';
      const expectedPath = path.resolve(ACTUAL_PROJECT_ROOT, userPath);
      expect(resolvePath(userPath)).toBe(expectedPath); // No override
    });

    it('should resolve a relative path with "." correctly', () => {
      const userPath = './src/./file.ts';
      const expectedPath = path.resolve(
        MOCK_PROJECT_ROOT_OVERRIDE,
        'src/file.ts',
      );
      expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toBe(
        expectedPath,
      );
    });

    it('should resolve a relative path with "." correctly using default root', () => {
      const userPath = './src/./file.ts';
      const expectedPath = path.resolve(ACTUAL_PROJECT_ROOT, 'src/file.ts');
      expect(resolvePath(userPath)).toBe(expectedPath);
    });

    it('should resolve a relative path with ".." correctly if it stays within root', () => {
      const userPath = 'src/../dist/bundle.js';
      const expectedPath = path.resolve(
        MOCK_PROJECT_ROOT_OVERRIDE,
        'dist/bundle.js',
      );
      expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toBe(
        expectedPath,
      );
    });

    it('should resolve a relative path with ".." correctly using default root', () => {
      const userPath = 'src/../dist/bundle.js';
      const expectedPath = path.resolve(ACTUAL_PROJECT_ROOT, 'dist/bundle.js');
      expect(resolvePath(userPath)).toBe(expectedPath);
    });

    it('should throw McpError for absolute paths (posix)', () => {
      const userPath = '/etc/passwd';
      // Test with override, should still fail
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        McpError,
      );
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        /Absolute paths are not allowed/,
      );
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        expect.objectContaining({ code: ErrorCode.InvalidParams }),
      );
      // Test without override
      expect(() => resolvePath(userPath)).toThrow(McpError);
      expect(() => resolvePath(userPath)).toThrow(
        /Absolute paths are not allowed/,
      );
      expect(() => resolvePath(userPath)).toThrow(
        expect.objectContaining({ code: ErrorCode.InvalidParams }),
      );
    });

    it('should throw McpError for absolute paths (windows)', () => {
      const userPath = 'C:\\Windows\\System32';
      const normalizedPath = path.normalize(userPath);
      // Test with override
      expect(() =>
        resolvePath(normalizedPath, MOCK_PROJECT_ROOT_OVERRIDE),
      ).toThrow(McpError);
      expect(() =>
        resolvePath(normalizedPath, MOCK_PROJECT_ROOT_OVERRIDE),
      ).toThrow(/Absolute paths are not allowed/);
      expect(() =>
        resolvePath(normalizedPath, MOCK_PROJECT_ROOT_OVERRIDE),
      ).toThrow(expect.objectContaining({ code: ErrorCode.InvalidParams }));
      // Test without override
      expect(() => resolvePath(normalizedPath)).toThrow(McpError);
      expect(() => resolvePath(normalizedPath)).toThrow(
        /Absolute paths are not allowed/,
      );
      expect(() => resolvePath(normalizedPath)).toThrow(
        expect.objectContaining({ code: ErrorCode.InvalidParams }),
      );
    });

    it('should throw McpError for path traversal attempts (using ..)', () => {
      const userPath = '../outside/file';
      // Test with override
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        McpError,
      );
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        /Path traversal detected/,
      );
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        expect.objectContaining({ code: ErrorCode.InvalidRequest }),
      );
      // Test without override
      expect(() => resolvePath(userPath)).toThrow(McpError);
      expect(() => resolvePath(userPath)).toThrow(/Path traversal detected/);
      expect(() => resolvePath(userPath)).toThrow(
        expect.objectContaining({ code: ErrorCode.InvalidRequest }),
      );
    });

    it('should throw McpError for path traversal attempts (using .. multiple times)', () => {
      const userPath = '../../../../outside/file';
      // Test with override
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        McpError,
      );
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        /Path traversal detected/,
      );
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        expect.objectContaining({ code: ErrorCode.InvalidRequest }),
      );
      // Test without override
      expect(() => resolvePath(userPath)).toThrow(McpError);
      expect(() => resolvePath(userPath)).toThrow(/Path traversal detected/);
      expect(() => resolvePath(userPath)).toThrow(
        expect.objectContaining({ code: ErrorCode.InvalidRequest }),
      );
    });

    it('should throw McpError if the input path is not a string', () => {
      const userPath: any = 123;
      // Test with override (should still fail type check before override matters)
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        McpError,
      );
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        /Path must be a string/,
      );
      expect(() => resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toThrow(
        expect.objectContaining({ code: ErrorCode.InvalidParams }),
      );
      // Test without override
      expect(() => resolvePath(userPath)).toThrow(McpError);
      expect(() => resolvePath(userPath)).toThrow(/Path must be a string/);
      expect(() => resolvePath(userPath)).toThrow(
        expect.objectContaining({ code: ErrorCode.InvalidParams }),
      );
    });

    it('should handle paths with trailing slashes', () => {
      const userPath = 'src/subdir/';
      const expectedPathOverride = path.resolve(
        MOCK_PROJECT_ROOT_OVERRIDE,
        'src/subdir',
      );
      expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toBe(
        expectedPathOverride,
      );
    });

    it('should handle paths with trailing slashes using default root', () => {
      const userPath = 'src/subdir/';
      const expectedPath = path.resolve(ACTUAL_PROJECT_ROOT, 'src/subdir');
      expect(resolvePath(userPath)).toBe(expectedPath);
    });

    it('should handle empty string path', () => {
      const userPath = '';
      // Test with override
      expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toBe(
        MOCK_PROJECT_ROOT_OVERRIDE,
      );
    });

    it('should handle empty string path using default root', () => {
      const userPath = '';
      const expectedPath = ACTUAL_PROJECT_ROOT; // Resolves to the root itself
      expect(resolvePath(userPath)).toBe(expectedPath);
    });

    it('should handle "." path', () => {
      const userPath = '.';
      // Test with override
      expect(resolvePath(userPath, MOCK_PROJECT_ROOT_OVERRIDE)).toBe(
        MOCK_PROJECT_ROOT_OVERRIDE,
      );
    });

    it('should handle "." path using default root', () => {
      const userPath = '.';
      const expectedPath = ACTUAL_PROJECT_ROOT; // Resolves to the root itself
      expect(resolvePath(userPath)).toBe(expectedPath);
    });
  });
});
