import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as fs from 'fs'; // Import fs for PathLike type
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createTemporaryFilesystem, cleanupTemporaryFilesystem } from '../testUtils.js';

// Mock pathUtils BEFORE importing the handler
// Mock pathUtils using vi.mock (hoisted)
const mockResolvePath = vi.fn<(userPath: string) => string>();
vi.mock('../../src/utils/pathUtils.js', () => ({
    PROJECT_ROOT: 'mocked/project/root', // Keep simple for now
    resolvePath: mockResolvePath,
}));

// Mock 'fs' module using doMock BEFORE importing the handler, targeting the 'promises' export
const mockMkdir = vi.fn();
vi.doMock('fs', async (importOriginal) => {
    const actualFs = await importOriginal<typeof import('fs')>();
    const actualFsPromises = actualFs.promises;

    // Set the default implementation for mockMkdir to call the actual function
    mockMkdir.mockImplementation(actualFsPromises.mkdir);

    return {
        ...actualFs, // Keep original non-promise functions
        promises: {
            ...actualFsPromises, // Keep other original promise functions by default
            mkdir: mockMkdir, // Use our mock function, which now defaults to the real one
            // Ensure stat also defaults to the real one, as it's used in error handling
            stat: vi.fn().mockImplementation(actualFsPromises.stat),
            // Add other functions if they are called and need default behavior
            // For now, assume only mkdir and stat within promises are critical
        },
    };
});

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
    vi.clearAllMocks(); // Clear all mocks
  });

  it('should create a single new directory', async () => {
    const request = { paths: ['newDir1'] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    // Use objectContaining to ignore extra properties like resolvedPath
    expect(result[0]).toEqual(expect.objectContaining({ path: 'newDir1', success: true }));

    // Verify directory creation
    const stats = await fsPromises.stat(path.join(tempRootDir, 'newDir1'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('should create multiple new directories', async () => {
    const request = { paths: ['multiDir1', 'multiDir2'] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({ path: 'multiDir1', success: true }));
    expect(result[1]).toEqual(expect.objectContaining({ path: 'multiDir2', success: true }));

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
    expect(result[0]).toEqual(expect.objectContaining({ path: 'nested/dir/structure', success: true }));

    // Verify directory creation
    const stats = await fsPromises.stat(path.join(tempRootDir, 'nested/dir/structure'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('should succeed if directory already exists', async () => {
    const request = { paths: ['existingDir'] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ path: 'existingDir', success: true })); // fs.mkdir recursive doesn't error

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
    // Match the actual error message observed in the previous run
    expect(result[0].error).toMatch(/Path exists but is not a directory/);
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


  it('should return error when attempting to create the project root', async () => {
    // Mock resolvePath to return the mocked project root for a specific input
    mockResolvePath.mockImplementation((relativePath: string): string => {
        if (relativePath === 'try_root') {
            return 'mocked/project/root'; // Return the mocked root
        }
        // Default behavior for other paths
        const absolutePath = path.resolve(tempRootDir, relativePath);
         if (!absolutePath.startsWith(tempRootDir)) {
             throw new McpError(ErrorCode.InvalidRequest, `Mocked Path traversal detected for ${relativePath}`);
         }
        return absolutePath;
    });

    const request = { paths: ['try_root'] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Creating the project root is not allowed/);
    expect(result[0].resolvedPath).toBe('mocked/project/root'); // Check resolved path
  });

  it('should handle permission errors during mkdir', async () => {
    const targetDir = 'permission_denied_dir';
    const targetPath = path.join(tempRootDir, targetDir); // Need the absolute path for mock comparison

    // Import actual fs *after* doMock to get the original functions
    const actualFsPromises = (await vi.importActual<typeof import('fs')>('fs')).promises;

    // Configure the mockMkdir for this specific test
    mockMkdir.mockImplementation(async (dirPath: fs.PathLike, options?: fs.MakeDirectoryOptions | number | string | null) => {
        const dirPathStr = dirPath.toString();
        if (dirPathStr === targetPath) { // Compare with absolute path
            const error: NodeJS.ErrnoException = new Error('Mocked EPERM error');
            error.code = 'EPERM';
            throw error;
        }
        // Delegate to actual mkdir for other paths
        return actualFsPromises.mkdir(dirPath, options);
    });

    const request = { paths: [targetDir] }; // Use relative path in request
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Permission denied creating directory: Mocked EPERM error/);
    // Check that our mock function was called with the resolved path
    expect(mockMkdir).toHaveBeenCalledWith(targetPath, { recursive: true });

    // vi.clearAllMocks() in afterEach handles cleanup
  });

   it('should handle generic errors during mkdir', async () => {
    const targetDir = 'generic_mkdir_error_dir';
    const targetPath = path.join(tempRootDir, targetDir); // Need the absolute path

    // Import actual fs *after* doMock to get the original functions
    const actualFsPromises = (await vi.importActual<typeof import('fs')>('fs')).promises;

    // Configure the mockMkdir for this specific test
    mockMkdir.mockImplementation(async (dirPath: fs.PathLike, options?: fs.MakeDirectoryOptions | number | string | null) => {
        const dirPathStr = dirPath.toString();
        if (dirPathStr === targetPath) { // Compare with absolute path
            throw new Error('Mocked generic mkdir error');
        }
        // Delegate to actual mkdir for other paths
        return actualFsPromises.mkdir(dirPath, options);
    });

    const request = { paths: [targetDir] }; // Use relative path in request
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Failed to create directory: Mocked generic mkdir error/);
    // Check that our mock function was called with the resolved path
    expect(mockMkdir).toHaveBeenCalledWith(targetPath, { recursive: true });

    // vi.clearAllMocks() in afterEach handles cleanup
  });

  it('should handle unexpected errors during path resolution within the map', async () => {
    // Mock resolvePath to throw a generic error for a specific path *after* initial validation
     mockResolvePath.mockImplementation((relativePath: string): string => {
        if (relativePath === 'unexpected_resolve_error') {
             throw new Error('Mocked unexpected resolve error');
         }
         // Default behavior
         const absolutePath = path.resolve(tempRootDir, relativePath);
         if (!absolutePath.startsWith(tempRootDir)) {
             throw new McpError(ErrorCode.InvalidRequest, `Mocked Path traversal detected for ${relativePath}`);
         }
         return absolutePath;
     });

    const request = { paths: ['goodDir', 'unexpected_resolve_error'] };
    const rawResult = await createDirectoriesToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(2);

    const goodResult = result.find((r: any) => r.path === 'goodDir');
    expect(goodResult).toBeDefined();
    expect(goodResult.success).toBe(true);

    const errorResult = result.find((r: any) => r.path === 'unexpected_resolve_error');
    expect(errorResult).toBeDefined();
    expect(errorResult.success).toBe(false);
    // This error is caught by the inner try/catch (lines 78-80)
    expect(errorResult.error).toMatch(/Failed to create directory: Mocked unexpected resolve error/);
    expect(errorResult.resolvedPath).toBe('Resolution failed'); // Check the specific resolvedPath value from line 80

     // Verify the successful creation occurred
     const statsNew = await fsPromises.stat(path.join(tempRootDir, 'goodDir'));
     expect(statsNew.isDirectory()).toBe(true);
  });

});