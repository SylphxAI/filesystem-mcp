import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createTemporaryFilesystem, cleanupTemporaryFilesystem } from '../testUtils.js';

// Mock pathUtils BEFORE importing the handler
const mockResolvePath = jest.fn<(userPath: string) => string>();
jest.unstable_mockModule('../../src/utils/pathUtils.js', () => ({
    PROJECT_ROOT: 'mocked/project/root',
    resolvePath: mockResolvePath,
}));

// Import the handler AFTER the mock
const { createDirectoriesToolDefinition } = await import('../../src/handlers/createDirectories.js');

// Define the initial structure (can be empty for this test)
const initialTestStructure = {
    'existingDir': {}
};

let tempRootDir: string;

describe('handleCreateDirectories Integration Tests', () => {
  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(initialTestStructure);

    // Configure the mock resolvePath
    mockResolvePath.mockImplementation((relativePath: string): string => {
        if (path.isAbsolute(relativePath)) {
             throw new McpError(ErrorCode.InvalidParams, `Mocked Absolute paths are not allowed for ${relativePath}`);
        }
        const absolutePath = path.resolve(tempRootDir, relativePath);
        if (!absolutePath.startsWith(tempRootDir)) {
            throw new McpError(ErrorCode.InvalidRequest, `Mocked Path traversal detected for ${relativePath}`);
        }
        // For createDirectories, the handler uses fs.mkdir with recursive: true,
        // so we don't need special existence checks in the mock.
        return absolutePath;
    });
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    mockResolvePath.mockClear();
  });

  it('should create a single new directory', async () => {
    const request = { paths: ['newDir1'] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'newDir1', success: true });

    // Verify directory creation
    const stats = await fsPromises.stat(path.join(tempRootDir, 'newDir1'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('should create multiple new directories', async () => {
    const request = { paths: ['multiDir1', 'multiDir2'] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: 'multiDir1', success: true });
    expect(result[1]).toEqual({ path: 'multiDir2', success: true });

    // Verify directory creation
    const stats1 = await fsPromises.stat(path.join(tempRootDir, 'multiDir1'));
    expect(stats1.isDirectory()).toBe(true);
    const stats2 = await fsPromises.stat(path.join(tempRootDir, 'multiDir2'));
    expect(stats2.isDirectory()).toBe(true);
  });

  it('should create nested directories', async () => {
    const request = { paths: ['nested/dir/structure'] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'nested/dir/structure', success: true });

    // Verify directory creation
    const stats = await fsPromises.stat(path.join(tempRootDir, 'nested/dir/structure'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('should succeed if directory already exists', async () => {
    const request = { paths: ['existingDir'] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'existingDir', success: true }); // fs.mkdir recursive doesn't error

    // Verify directory still exists
    const stats = await fsPromises.stat(path.join(tempRootDir, 'existingDir'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('should return error if path is an existing file', async () => {
    // Create a file first
    const filePath = 'existingFile.txt';
    await fsPromises.writeFile(path.join(tempRootDir, filePath), 'hello');

    const request = { paths: [filePath] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/EEXIST: file already exists/); // Or similar error from fs.mkdir
  });


  it('should handle mixed success and failure cases', async () => {
    const request = {
      paths: [
        'newGoodDir', // success
        'existingDir', // success (already exists)
        '../outsideDir', // failure (traversal mock)
      ],
    };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(3);

    const successNew = result.find((r: any) => r.path === 'newGoodDir');
    expect(successNew).toBeDefined();
    expect(successNew.success).toBe(true);

    const successExisting = result.find((r: any) => r.path === 'existingDir');
    expect(successExisting).toBeDefined();
    expect(successExisting.success).toBe(true);

    const traversal = result.find((r: any) => r.path === '../outsideDir');
    expect(traversal).toBeDefined();
    expect(traversal.success).toBe(false);
    expect(traversal.error).toMatch(/Mocked Path traversal detected/);

    // Verify the successful creation occurred
    const statsNew = await fsPromises.stat(path.join(tempRootDir, 'newGoodDir'));
    expect(statsNew.isDirectory()).toBe(true);
  });

   it('should return error for absolute paths (caught by mock resolvePath)', async () => {
    const absolutePath = path.resolve(tempRootDir, 'newAbsoluteDir');
    const request = { paths: [absolutePath] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should reject requests with empty paths array based on Zod schema', async () => {
    const request = { paths: [] };
    await expect(createDirectoriesToolDefinition.handler(request)).rejects.toThrow(McpError);
    await expect(createDirectoriesToolDefinition.handler(request)).rejects.toThrow(/Paths array cannot be empty/);
  });

});