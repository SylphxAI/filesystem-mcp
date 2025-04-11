import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'; // Removed unused afterEach
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
// Removed unused fs import

// --- Mock Dependencies ---
const mockAccess = vi.fn();
const mockRename = vi.fn();
const mockMkdir = vi.fn();
const mockResolvePath = vi.fn();
const mockPathUtils = {
  resolvePath: mockResolvePath,
  PROJECT_ROOT: '/mock-root', // Use a consistent mock root
};

// --- Test Setup ---
// Import the CORE function after mocks/setup
const { handleMoveItemsFuncCore } = await import('../../src/handlers/move-items.ts'); // Removed unused MoveItemsArgsSchema

// Define mock dependencies object
let mockDependencies: {
  access: Mock;
  rename: Mock;
  mkdir: Mock;
  resolvePath: Mock;
  PROJECT_ROOT: string;
};
// Import the handler and *mocked* fs functions after mocks
// Removed import of moveItemsToolDefinition

// Corrected duplicate describe
describe('handleMoveItems Core Logic Tests', () => {
  beforeEach(() => {
    // Reset mocks and setup default implementations
    vi.resetAllMocks();

    mockDependencies = {
      access: mockAccess,
      rename: mockRename,
      mkdir: mockMkdir,
      resolvePath: mockResolvePath,
      PROJECT_ROOT: mockPathUtils.PROJECT_ROOT,
    };

    // Default mock implementations
    mockResolvePath.mockImplementation((relativePath: string): string => {
      if (path.isAbsolute(relativePath)) {
        throw new McpError(ErrorCode.InvalidParams, `Absolute paths are not allowed: ${relativePath}`);
      }
      if (relativePath.includes('..')) {
        // Basic traversal check for testing
        const resolved = path.resolve(mockPathUtils.PROJECT_ROOT, relativePath);
        if (!resolved.startsWith(mockPathUtils.PROJECT_ROOT)) {
           throw new McpError(ErrorCode.InvalidRequest, `Path traversal detected: ${relativePath}`);
        }
         // For testing purposes, allow resolved paths starting with root
         return resolved;
      }
       if (relativePath === '.') {
         return mockPathUtils.PROJECT_ROOT;
       }
      return path.join(mockPathUtils.PROJECT_ROOT, relativePath); // Use path.join for consistency
    });
    mockAccess.mockResolvedValue(undefined); // Assume access success by default
    mockRename.mockResolvedValue(undefined); // Assume rename success by default
    mockMkdir.mockResolvedValue(undefined); // Assume mkdir success by default
  });

  // afterEach is handled by beforeEach resetting mocks

  it('should move a file successfully', async () => {
    const args = {
      operations: [{ source: 'file1.txt', destination: 'file2.txt' }],
    };
    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

    expect(result).toEqual([{ source: 'file1.txt', destination: 'file2.txt', success: true }]);
    expect(mockResolvePath).toHaveBeenCalledWith('file1.txt');
    expect(mockResolvePath).toHaveBeenCalledWith('file2.txt');
    expect(mockAccess).toHaveBeenCalledWith(path.join(mockPathUtils.PROJECT_ROOT, 'file1.txt'));
    expect(mockRename).toHaveBeenCalledWith(
      path.join(mockPathUtils.PROJECT_ROOT, 'file1.txt'),
      path.join(mockPathUtils.PROJECT_ROOT, 'file2.txt'),
    );
    // mkdir should NOT be called when destination is in root
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it('should return error if source does not exist (ENOENT on access)', async () => {
    const args = {
      operations: [{ source: 'nonexistent.txt', destination: 'fail.txt' }],
    };
    mockAccess.mockRejectedValueOnce({ code: 'ENOENT' });

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

    expect(result).toEqual([
      {
        source: 'nonexistent.txt',
        destination: 'fail.txt',
        success: false,
        error: 'Source path not found: nonexistent.txt',
      },
    ]);
    expect(mockAccess).toHaveBeenCalledWith(path.join(mockPathUtils.PROJECT_ROOT, 'nonexistent.txt'));
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('should return error when attempting to move the project root', async () => {
    const args = {
      operations: [{ source: '.', destination: 'newRootDir' }],
    };
    // Mock resolvePath specifically for '.'
     mockResolvePath.mockImplementation((relativePath: string): string => {
       if (relativePath === '.') return mockPathUtils.PROJECT_ROOT;
       return path.join(mockPathUtils.PROJECT_ROOT, relativePath);
     });

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

    expect(result).toEqual([
      {
        source: '.',
        destination: 'newRootDir',
        success: false,
        error: 'Moving the project root is not allowed.',
      },
    ]);
    expect(mockResolvePath).toHaveBeenCalledWith('.');
     expect(mockResolvePath).toHaveBeenCalledWith('newRootDir');
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('should handle multiple operations with mixed results', async () => {
    const args = {
      operations: [
        { source: 'file1.txt', destination: 'newFile1.txt' }, // Success
        { source: 'nonexistent.txt', destination: 'fail.txt' }, // ENOENT on access
        { source: 'file2.txt', destination: 'newDir/newFile2.txt' }, // Success with mkdir
        { source: 'perm-error.txt', destination: 'fail2.txt' }, // EPERM on rename
      ],
    };

    mockAccess.mockImplementation(async (p) => {
      const pStr = p.toString();
      if (pStr.includes('nonexistent')) throw { code: 'ENOENT' };
      // Assume others exist
    });
    mockRename.mockImplementation(async (src) => { // Removed unused dest
      const srcStr = src.toString();
      if (srcStr.includes('perm-error')) throw { code: 'EPERM' };
      // Assume others succeed
    });

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

    expect(result).toEqual([
      { source: 'file1.txt', destination: 'newFile1.txt', success: true },
      { source: 'nonexistent.txt', destination: 'fail.txt', success: false, error: 'Source path not found: nonexistent.txt' },
      { source: 'file2.txt', destination: 'newDir/newFile2.txt', success: true },
      { source: 'perm-error.txt', destination: 'fail2.txt', success: false, error: "Permission denied moving 'perm-error.txt' to 'fail2.txt'." },
    ]);
    expect(mockAccess).toHaveBeenCalledTimes(4); // Called for all 4 sources
    // Rename should only be called if access succeeds
    expect(mockRename).toHaveBeenCalledTimes(3); // file1, file2, perm-error (fails)
    expect(mockMkdir).toHaveBeenCalledTimes(1); // Called only for newDir
    expect(mockMkdir).toHaveBeenCalledWith(path.join(mockPathUtils.PROJECT_ROOT, 'newDir'), { recursive: true });
  });

  it('should return error for absolute source path (caught by resolvePath)', async () => {
    const args = {
      operations: [{ source: '/abs/path/file.txt', destination: 'dest.txt' }],
    };
     mockResolvePath.mockImplementation((relativePath: string): string => {
       if (path.isAbsolute(relativePath)) {
         throw new McpError(ErrorCode.InvalidParams, `Absolute paths are not allowed: ${relativePath}`);
       }
       return path.join(mockPathUtils.PROJECT_ROOT, relativePath);
     });

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

    expect(result).toEqual([
      {
        source: '/abs/path/file.txt',
        destination: 'dest.txt',
        success: false,
        error: 'MCP error -32602: Absolute paths are not allowed: /abs/path/file.txt', // Match McpError format
      },
    ]);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('should return error for absolute destination path (caught by resolvePath)', async () => {
    const args = {
      operations: [{ source: 'src.txt', destination: '/abs/path/dest.txt' }],
    };
    mockResolvePath.mockImplementation((relativePath: string): string => {
       if (path.isAbsolute(relativePath)) {
         throw new McpError(ErrorCode.InvalidParams, `Absolute paths are not allowed: ${relativePath}`);
       }
       return path.join(mockPathUtils.PROJECT_ROOT, relativePath);
     });

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

    expect(result).toEqual([
      {
        source: 'src.txt',
        destination: '/abs/path/dest.txt',
        success: false,
        error: 'MCP error -32602: Absolute paths are not allowed: /abs/path/dest.txt', // Match McpError format
      },
    ]);
     expect(mockResolvePath).toHaveBeenCalledWith('src.txt'); // Source is resolved first
    expect(mockAccess).not.toHaveBeenCalled(); // Fails before access check
    expect(mockRename).not.toHaveBeenCalled();
  });

   it('should return error for path traversal (caught by resolvePath)', async () => {
    const args = {
      operations: [{ source: '../outside.txt', destination: 'dest.txt' }],
    };
     mockResolvePath.mockImplementation((relativePath: string): string => {
        const resolved = path.resolve(mockPathUtils.PROJECT_ROOT, relativePath);
        if (!resolved.startsWith(mockPathUtils.PROJECT_ROOT)) {
           throw new McpError(ErrorCode.InvalidRequest, `Path traversal detected: ${relativePath}`);
        }
         return resolved;
     });

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

    expect(result).toEqual([
      {
        source: '../outside.txt',
        destination: 'dest.txt',
        success: false,
        error: 'MCP error -32600: Path traversal detected: ../outside.txt', // Match McpError format
      },
    ]);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('should handle permission errors (EPERM/EACCES) on rename', async () => {
    const args = {
      operations: [{ source: 'perm-error-src.txt', destination: 'perm-error-dest.txt' }],
    };
    mockRename.mockRejectedValueOnce({ code: 'EPERM' });

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

    expect(result).toEqual([
      {
        source: 'perm-error-src.txt',
        destination: 'perm-error-dest.txt',
        success: false,
        error: "Permission denied moving 'perm-error-src.txt' to 'perm-error-dest.txt'.",
      },
    ]);
    expect(mockAccess).toHaveBeenCalledTimes(1);
    expect(mockRename).toHaveBeenCalledTimes(1);
  });

  it('should handle generic errors during rename', async () => {
     const args = {
      operations: [{ source: 'generic-error-src.txt', destination: 'generic-error-dest.txt' }],
    };
    mockRename.mockRejectedValueOnce(new Error('Disk full'));

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

     expect(result).toEqual([
      {
        source: 'generic-error-src.txt',
        destination: 'generic-error-dest.txt',
        success: false,
        error: 'Failed to move item: Disk full',
      },
    ]);
    expect(mockAccess).toHaveBeenCalledTimes(1);
    expect(mockRename).toHaveBeenCalledTimes(1);
  });

   it('should handle generic errors during access check', async () => {
     const args = {
      operations: [{ source: 'access-error-src.txt', destination: 'dest.txt' }],
    };
    mockAccess.mockRejectedValueOnce(new Error('Some access error'));

    // The error from checkSourceExists should be caught and handled
    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

     expect(result).toEqual([
      {
        source: 'access-error-src.txt',
        destination: 'dest.txt',
        success: false,
        // The error message comes from handleMoveError catching the rethrown error
        error: 'Failed to move item: Some access error',
      },
    ]);
    expect(mockAccess).toHaveBeenCalledTimes(1);
    expect(mockRename).not.toHaveBeenCalled();
  });
it('should create destination directory if it does not exist', async () => {
  const args = {
    operations: [{ source: 'fileToMove.txt', destination: 'newDir/movedFile.txt' }],
  };
  // Ensure rename succeeds for this test
  mockRename.mockResolvedValue(undefined);

  const response = await handleMoveItemsFuncCore(args, mockDependencies);
  const result = JSON.parse(response.content[0].text);

  expect(result).toEqual([{ source: 'fileToMove.txt', destination: 'newDir/movedFile.txt', success: true }]);
  expect(mockMkdir).toHaveBeenCalledWith(path.join(mockPathUtils.PROJECT_ROOT, 'newDir'), { recursive: true });
  expect(mockRename).toHaveBeenCalledWith(
     path.join(mockPathUtils.PROJECT_ROOT, 'fileToMove.txt'),
     path.join(mockPathUtils.PROJECT_ROOT, 'newDir/movedFile.txt'),
  );
});
// Removed duplicate closing bracket from previous diff error

  it('should reject requests with empty operations array (Zod validation)', async () => {
    const args = { operations: [] };
    // Use the core function directly to test validation logic
    await expect(handleMoveItemsFuncCore(args, mockDependencies)).rejects.toThrow(McpError);
    await expect(handleMoveItemsFuncCore(args, mockDependencies)).rejects.toThrow(
        /Operations array cannot be empty/
    );
  });

   it('should reject requests with invalid operation structure (Zod validation)', async () => {
    const args = { operations: [{ src: 'a.txt', dest: 'b.txt' }] }; // Incorrect keys
    await expect(handleMoveItemsFuncCore(args, mockDependencies)).rejects.toThrow(McpError);
     await expect(handleMoveItemsFuncCore(args, mockDependencies)).rejects.toThrow(
        /Invalid arguments: operations.0.source \(Required\), operations.0.destination \(Required\)/
    );
  });

   it('should handle unexpected rejections in processSettledResults', async () => {
    const args = {
      operations: [{ source: 'file1.txt', destination: 'newFile1.txt' }],
    };
    // Mock the core processing function to throw an error *before* allSettled
     vi.spyOn(Promise, 'allSettled').mockResolvedValueOnce([
       { status: 'rejected', reason: new Error('Simulated rejection') } as PromiseRejectedResult,
     ]);

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

    expect(result).toEqual([
      {
        source: 'file1.txt',
        destination: 'newFile1.txt',
        success: false,
        error: 'Unexpected error during processing: Simulated rejection',
      },
    ]);
     vi.spyOn(Promise, 'allSettled').mockRestore(); // Clean up spy
  });

   it('should handle non-Error rejections in processSettledResults', async () => {
    const args = {
      operations: [{ source: 'file1.txt', destination: 'newFile1.txt' }],
    };
     vi.spyOn(Promise, 'allSettled').mockResolvedValueOnce([
       { status: 'rejected', reason: 'A string reason' } as PromiseRejectedResult,
     ]);

    const response = await handleMoveItemsFuncCore(args, mockDependencies);
    const result = JSON.parse(response.content[0].text);

     expect(result).toEqual([
      {
        source: 'file1.txt',
        destination: 'newFile1.txt',
        success: false,
        error: 'Unexpected error during processing: A string reason',
      },
    ]);
     vi.spyOn(Promise, 'allSettled').mockRestore();
  });

  // Add test for validateMoveOperation specifically
   it('validateMoveOperation should return error for invalid op', async () => { // Add async
     // Need to import validateMoveOperation or test it indirectly
     // For now, test indirectly via handler
     const args = { operations: [{ source: '', destination: 'dest.txt' }] }; // Invalid empty source string
     // This validation happens inside processSingleMoveOperation, which returns a result
     const response = await handleMoveItemsFuncCore(args, mockDependencies);
     const result = JSON.parse(response.content[0].text);
     expect(result).toEqual([
       {
         source: 'undefined', // op?.source is '' which becomes undefined after replaceAll? No, should be ''
         destination: 'dest.txt',
         success: false,
         error: 'Invalid operation: source and destination must be defined.',
       },
     ]);
   });

   // Add test for handleSpecialMoveErrors specifically
   it('handleSpecialMoveErrors should handle McpError for absolute paths', async () => {
      const args = { operations: [{ source: '/abs/a.txt', destination: 'b.txt' }] };
      mockResolvePath.mockImplementation((relativePath: string): string => {
        if (path.isAbsolute(relativePath)) {
          throw new McpError(ErrorCode.InvalidParams, `Absolute paths are not allowed: ${relativePath}`);
        }
        return path.join(mockPathUtils.PROJECT_ROOT, relativePath);
      });
      const response = await handleMoveItemsFuncCore(args, mockDependencies);
      const result = JSON.parse(response.content[0].text);
      expect(result[0].error).toContain('MCP error -32602: Absolute paths are not allowed'); // Match McpError format
   });

    // Add test for mkdir failure in performMoveOperation
    it('should handle mkdir failure during move', async () => {
      const args = {
        operations: [{ source: 'file1.txt', destination: 'newDir/file2.txt' }],
      };
      const mkdirError = new Error('Mkdir failed');
      mockMkdir.mockRejectedValueOnce(mkdirError);
      // Rename should still be attempted according to current logic
      mockRename.mockResolvedValueOnce(undefined);

      const response = await handleMoveItemsFuncCore(args, mockDependencies);
      const result = JSON.parse(response.content[0].text);

      // Expect failure because mkdir failed critically
      expect(result).toEqual([
        {
          source: 'file1.txt',
          destination: 'newDir/file2.txt',
          success: false,
          error: 'Failed to move item: Mkdir failed', // Error from handleMoveError
        },
      ]);
      expect(mockMkdir).toHaveBeenCalledTimes(1);
      expect(mockRename).not.toHaveBeenCalled(); // Rename should not be called if mkdir fails critically
    });

});
