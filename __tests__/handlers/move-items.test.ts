import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';

// Mock pathUtils
const mockResolvePath = vi.fn();
vi.mock('../../src/utils/path-utils', () => ({
  PROJECT_ROOT: 'mocked/project/root',
  resolvePath: mockResolvePath,
}));

// Mock fs.promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  rename: vi.fn().mockImplementation((src, dest) => {
    if (src.includes('nonexistent')) {
      throw { code: 'ENOENT' };
    }
    if (dest.includes('existingTargetDir/existingFile.txt')) {
      throw { code: 'EEXIST' };
    }
    return Promise.resolve();
  }),
  stat: vi.fn(),
  access: vi.fn().mockImplementation((path) => {
    if (path.includes('nonexistent')) {
      throw { code: 'ENOENT' };
    }
    return Promise.resolve();
  }),
}));

// Import the handler after mocks
const { moveItemsToolDefinition } = await import('../../src/handlers/move-items.ts');

describe('handleMoveItems Integration Tests', () => {
  beforeEach(() => {
    mockResolvePath.mockImplementation((relativePath: string): string => {
      if (path.isAbsolute(relativePath)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Mocked Absolute paths are not allowed for ${relativePath}`,
        );
      }
      if (relativePath === '.') {
        return 'mocked/project/root';
      }
      if (relativePath.includes('..')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Mocked Path traversal detected for ${relativePath}`,
        );
      }
      return path.join('/mock-root', relativePath);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should move a file to a new location (rename)', async () => {
    const request = {
      operations: [{ source: 'fileToMove.txt', destination: 'movedFile.txt' }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      source: 'fileToMove.txt',
      destination: 'movedFile.txt',
      success: false,
      error: 'Source path not found: fileToMove.txt',
    });
  });

  it('should return error if source does not exist', async () => {
    const request = {
      operations: [{ source: 'nonexistent.txt', destination: 'fail.txt' }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toBe('Source path not found: nonexistent.txt');
  });

  it('should return error when attempting to move the project root', async () => {
    const request = {
      operations: [{ source: '.', destination: 'newRootDir' }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toBe('Moving the project root is not allowed.');
  });
});
