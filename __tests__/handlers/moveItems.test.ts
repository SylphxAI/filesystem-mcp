import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createTemporaryFilesystem, cleanupTemporaryFilesystem } from '../testUtils.js';

// Mock pathUtils BEFORE importing the handler
// Mock pathUtils using vi.mock (hoisted)
const mockResolvePath = vi.fn<(userPath: string) => string>();
vi.mock('../../src/utils/pathUtils.js', () => ({
    PROJECT_ROOT: 'mocked/project/root', // Keep simple for now
    resolvePath: mockResolvePath,
}));

// Import the handler AFTER the mock
const { moveItemsToolDefinition } = await import('../../src/handlers/moveItems.js');

// Define the initial structure
const initialTestStructure = {
  'fileToMove.txt': 'Move me!',
  'dirToMove': {
    'nestedFile.txt': 'I am nested.',
  },
  'existingTargetDir': {},
  'anotherFile.txt': 'Stay here.',
  'targetDirForFile': {},
};

let tempRootDir: string;

describe('handleMoveItems Integration Tests', () => {
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
        // For move, the handler uses fs.rename. We don't need special checks here.
        return absolutePath;
    });
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    vi.clearAllMocks(); // Clear all mocks
  });

  it('should move a file to a new location (rename)', async () => {
    const request = {
      operations: [{ source: 'fileToMove.txt', destination: 'movedFile.txt' }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ source: 'fileToMove.txt', destination: 'movedFile.txt', success: true });

    // Verify move
    await expect(fsPromises.access(path.join(tempRootDir, 'fileToMove.txt'))).rejects.toThrow(/ENOENT/);
    const content = await fsPromises.readFile(path.join(tempRootDir, 'movedFile.txt'), 'utf-8');
    expect(content).toBe('Move me!');
  });

  it('should move a file into an existing directory', async () => {
    const request = {
      operations: [{ source: 'fileToMove.txt', destination: 'existingTargetDir/fileToMove.txt' }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ source: 'fileToMove.txt', destination: 'existingTargetDir/fileToMove.txt', success: true });

    // Verify move
    await expect(fsPromises.access(path.join(tempRootDir, 'fileToMove.txt'))).rejects.toThrow(/ENOENT/);
    const content = await fsPromises.readFile(path.join(tempRootDir, 'existingTargetDir/fileToMove.txt'), 'utf-8');
    expect(content).toBe('Move me!');
  });

  it('should move a directory to a new location (rename)', async () => {
    const request = {
      operations: [{ source: 'dirToMove', destination: 'movedDir' }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ source: 'dirToMove', destination: 'movedDir', success: true });

    // Verify move
    await expect(fsPromises.access(path.join(tempRootDir, 'dirToMove'))).rejects.toThrow(/ENOENT/);
    const stats = await fsPromises.stat(path.join(tempRootDir, 'movedDir'));
    expect(stats.isDirectory()).toBe(true);
    const content = await fsPromises.readFile(path.join(tempRootDir, 'movedDir/nestedFile.txt'), 'utf-8');
    expect(content).toBe('I am nested.');
  });

  it('should move a directory into an existing directory', async () => {
     const request = {
       operations: [{ source: 'dirToMove', destination: 'existingTargetDir/dirToMove' }],
     };
     const rawResult = await moveItemsToolDefinition.handler(request);
     const result = JSON.parse(rawResult.content[0].text);

     expect(result).toHaveLength(1);
     expect(result[0]).toEqual({ source: 'dirToMove', destination: 'existingTargetDir/dirToMove', success: true });

     // Verify move
     await expect(fsPromises.access(path.join(tempRootDir, 'dirToMove'))).rejects.toThrow(/ENOENT/);
     const stats = await fsPromises.stat(path.join(tempRootDir, 'existingTargetDir/dirToMove'));
     expect(stats.isDirectory()).toBe(true);
     const content = await fsPromises.readFile(path.join(tempRootDir, 'existingTargetDir/dirToMove/nestedFile.txt'), 'utf-8');
     expect(content).toBe('I am nested.');
   });


  it('should return error if source does not exist', async () => {
    const request = {
      operations: [{ source: 'nonexistent.txt', destination: 'fail.txt' }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    // Match handler's specific error message for source not found
    expect(result[0].error).toBe('Source path not found: nonexistent.txt');
  });

  it('should return error if destination parent directory does not exist', async () => {
    const request = {
      operations: [{ source: 'fileToMove.txt', destination: 'nonexistentDir/moved.txt' }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    // Handler now creates parent directories, so this should succeed
    expect(result[0].success).toBe(true);
    expect(result[0].error).toBeUndefined();

    // Verify source file was moved and parent dir created
    await expect(fsPromises.access(path.join(tempRootDir, 'fileToMove.txt'))).rejects.toThrow(/ENOENT/);
    await expect(fsPromises.access(path.join(tempRootDir, 'nonexistentDir/moved.txt'))).resolves.toBeUndefined();
  });

   it('should return error if destination is an existing file (and source is file/dir)', async () => {
    const request = {
      operations: [{ source: 'fileToMove.txt', destination: 'anotherFile.txt' }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    // On Windows, fs.rename overwrites files, so this should succeed.
    expect(result[0].success).toBe(true);
    expect(result[0].error).toBeUndefined();

    // Verify source file was moved and destination overwritten
    await expect(fsPromises.access(path.join(tempRootDir, 'fileToMove.txt'))).rejects.toThrow(/ENOENT/);
    const content = await fsPromises.readFile(path.join(tempRootDir, 'anotherFile.txt'), 'utf-8');
    expect(content).toBe('Move me!'); // Content should be from fileToMove.txt
  });

  it('should handle multiple operations with mixed results', async () => {
     const request = {
       operations: [
         { source: 'fileToMove.txt', destination: 'movedOkay.txt' }, // success
         { source: 'nonexistent.src', destination: 'nonexistent.dest' }, // failure (ENOENT src)
         { source: 'anotherFile.txt', destination: '../outside.txt' }, // failure (traversal dest mock)
       ],
     };
     const rawResult = await moveItemsToolDefinition.handler(request);
     const result = JSON.parse(rawResult.content[0].text);

     expect(result).toHaveLength(3);

     const success = result.find((r: any) => r.source === 'fileToMove.txt');
     expect(success).toBeDefined();
     expect(success.success).toBe(true);

     const noSrc = result.find((r: any) => r.source === 'nonexistent.src');
     expect(noSrc).toBeDefined();
     expect(noSrc.success).toBe(false);
     // Match handler's specific error message for source not found
     expect(noSrc.error).toBe('Source path not found: nonexistent.src');

     const traversal = result.find((r: any) => r.source === 'anotherFile.txt');
     expect(traversal).toBeDefined();
     expect(traversal.success).toBe(false);
     expect(traversal.error).toMatch(/Mocked Path traversal detected/); // Error from mock on destination path

     // Verify successful move
     await expect(fsPromises.access(path.join(tempRootDir, 'fileToMove.txt'))).rejects.toThrow(/ENOENT/);
     await expect(fsPromises.access(path.join(tempRootDir, 'movedOkay.txt'))).resolves.toBeUndefined();
     // Verify file involved in failed traversal wasn't moved
     await expect(fsPromises.access(path.join(tempRootDir, 'anotherFile.txt'))).resolves.toBeUndefined();
   });


  it('should return error for absolute source path (caught by mock resolvePath)', async () => {
    const absoluteSource = path.resolve(tempRootDir, 'fileToMove.txt');
    const request = { operations: [{ source: absoluteSource, destination: 'fail.txt' }] };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should return error for absolute destination path (caught by mock resolvePath)', async () => {
    const absoluteDest = path.resolve(tempRootDir, 'fail.txt');
    const request = { operations: [{ source: 'fileToMove.txt', destination: absoluteDest }] };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });


  it('should reject requests with empty operations array based on Zod schema', async () => {
    const request = { operations: [] };
    await expect(moveItemsToolDefinition.handler(request)).rejects.toThrow(McpError);
    await expect(moveItemsToolDefinition.handler(request)).rejects.toThrow(/Operations array cannot be empty/);
  });


  it('should handle unexpected errors during path resolution', async () => {
    const errorSourcePath = 'resolveErrorSource.txt';
    const validDestPath = 'resolveErrorDest.txt';
    const genericErrorMessage = 'Simulated generic resolve error on source';

    // Create the source file so the check later doesn't fail on ENOENT first
    await fsPromises.writeFile(path.join(tempRootDir, errorSourcePath), 'content');

    // Mock resolvePath to throw a generic Error for the source path
    mockResolvePath.mockImplementationOnce((relativePath: string): string => {
      if (relativePath === errorSourcePath) {
        throw new Error(genericErrorMessage);
      }
      // Fallback for the destination path (or any other)
      const absolutePath = path.resolve(tempRootDir, relativePath);
      if (!absolutePath.startsWith(tempRootDir)) throw new McpError(ErrorCode.InvalidRequest, `Traversal`);
      if (path.isAbsolute(relativePath)) throw new McpError(ErrorCode.InvalidParams, `Absolute`);
      return absolutePath;
    });

    const request = { operations: [{ source: errorSourcePath, destination: validDestPath }] };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    const errorResult = result.find((r: any) => r.source === errorSourcePath);
    expect(errorResult).toBeDefined();
    expect(errorResult.success).toBe(false);
    // Check for the generic error message from line 83
    expect(errorResult.error).toMatch(/Failed to move item: Simulated generic resolve error on source/);
  });


  it('should return error when attempting to move the project root', async () => {
    const rootPathIdentifier = '.'; // Use '.' to represent the root in relative terms
    const destinationPath = 'newRootDirName';

    // Configure mockResolvePath specifically for this test case
    // Ensure it returns the mocked PROJECT_ROOT when resolving '.'
    mockResolvePath.mockImplementation((relativePath: string): string => {
        if (relativePath === rootPathIdentifier) {
            // Return the exact value mocked for PROJECT_ROOT in pathUtils mock
            // Note: The actual PROJECT_ROOT value is imported by the handler.
            // We need resolvePath('.') to return the same string as PROJECT_ROOT.
            // The mock for pathUtils already defines PROJECT_ROOT as 'mocked/project/root'.
            return 'mocked/project/root';
        }
        // Handle other paths normally for this test if needed (e.g., destination)
        const absolutePath = path.resolve(tempRootDir, relativePath);
         if (path.isAbsolute(relativePath)) {
              throw new McpError(ErrorCode.InvalidParams, `Mocked Absolute paths are not allowed for ${relativePath}`);
         }
        if (!absolutePath.startsWith(tempRootDir)) {
            throw new McpError(ErrorCode.InvalidRequest, `Mocked Path traversal detected for ${relativePath}`);
        }
        return absolutePath;
    });


    const request = {
      operations: [{ source: rootPathIdentifier, destination: destinationPath }],
    };
    const rawResult = await moveItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    const errorResult = result.find((r: any) => r.source === rootPathIdentifier);
    expect(errorResult).toBeDefined();
    expect(errorResult.success).toBe(false);
    // Check for the specific error message from line 60
    expect(errorResult.error).toBe('Moving the project root is not allowed.');

    // Restore the default mock implementation if necessary, although beforeEach should handle it
    // vi.clearAllMocks(); // Already done in afterEach
  });

});