import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// import * as fsPromises from 'fs/promises'; // Removed unused import
// import * as actualFsPromises from 'fs/promises'; // Removed unused import

import * as path from 'path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  createTemporaryFilesystem,
  cleanupTemporaryFilesystem,
} from '../testUtils.js';

// Mock pathUtils BEFORE importing the handler
// Mock pathUtils using vi.mock (hoisted)
const mockResolvePath = vi.fn<(userPath: string) => string>();
vi.mock('../../src/utils/pathUtils.js', () => ({
  PROJECT_ROOT: 'mocked/project/root', // Keep simple for now
  resolvePath: mockResolvePath,
}));

// Import the handler AFTER the mock
const { readContentToolDefinition } = await import(
  '../../src/handlers/readContent.js'
);

// Define the structure for the temporary filesystem
const testStructure = {
  'file1.txt': 'Hello World!',
  dir1: {
    'file2.js': 'console.log("test");',
    'another.txt': 'More content here.',
  },
  'emptyFile.txt': '',
  'binaryFile.bin': Buffer.from([0x01, 0x02, 0x03, 0x04]), // Example binary data
};

let tempRootDir: string;

describe('handleReadContent Integration Tests', () => {
  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(testStructure);

    // Configure the mock resolvePath
    mockResolvePath.mockImplementation((relativePath: string): string => {
      // Simulate absolute path rejection first, as the original does
      if (path.isAbsolute(relativePath)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Mocked Absolute paths are not allowed for ${relativePath}`,
        );
      }
      // Resolve the path relative to the temp directory
      const absolutePath = path.resolve(tempRootDir, relativePath);
      // Simulate path traversal check
      if (!absolutePath.startsWith(tempRootDir)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Mocked Path traversal detected for ${relativePath}`,
        );
      }
      // Return the resolved path. The actual fs.readFile in the handler will handle ENOENT.
      return absolutePath;
    });
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    vi.clearAllMocks(); // Clear all mocks
  });

  it('should read content from existing files', async () => {
    const request = {
      paths: ['file1.txt', 'dir1/file2.js', 'emptyFile.txt'],
    };
    const rawResult = await readContentToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text); // Assuming similar return structure

    expect(result).toHaveLength(3);

    const file1 = result.find((r: any) => r.path === 'file1.txt');
    expect(file1).toBeDefined();
    expect(file1.error).toBeUndefined(); // Check for absence of error
    expect(file1.content).toBe('Hello World!');

    const file2 = result.find((r: any) => r.path === 'dir1/file2.js');
    expect(file2).toBeDefined();
    expect(file2.error).toBeUndefined(); // Check for absence of error
    expect(file2.content).toBe('console.log("test");');

    const emptyFile = result.find((r: any) => r.path === 'emptyFile.txt');
    expect(emptyFile).toBeDefined();
    expect(emptyFile.error).toBeUndefined(); // Check for absence of error
    expect(emptyFile.content).toBe('');
  });

  it('should return errors for non-existent files', async () => {
    const request = {
      paths: ['file1.txt', 'nonexistent.txt'],
    };
    const rawResult = await readContentToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(2);

    const file1 = result.find((r: any) => r.path === 'file1.txt');
    expect(file1).toBeDefined();
    expect(file1.error).toBeUndefined(); // Check for absence of error
    expect(file1.content).toBeDefined(); // Should have content

    const nonexistent = result.find((r: any) => r.path === 'nonexistent.txt');
    expect(nonexistent).toBeDefined();
    expect(nonexistent.content).toBeUndefined(); // Should not have content
    expect(nonexistent.error).toBeDefined(); // Should have an error
    // Check the specific error message from the handler for ENOENT - updated based on handler code
    expect(nonexistent.error).toMatch(/File not found at resolved path/);
    expect(nonexistent.error).toContain(
      path.resolve(tempRootDir, 'nonexistent.txt'),
    ); // Check resolved path is in the error message
  });

  it('should return errors for directories', async () => {
    const request = {
      paths: ['dir1'],
    };
    const rawResult = await readContentToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    const dir1 = result[0];
    expect(dir1.path).toBe('dir1');
    expect(dir1.content).toBeUndefined(); // Should not have content
    expect(dir1.error).toBeDefined(); // Should have an error
    // Check the specific error message from the handler for non-files
    expect(dir1.error).toMatch(/Path is not a regular file: dir1/); // Match the updated error message
  });

  it('should return error for absolute paths (caught by mock resolvePath)', async () => {
    const absolutePath = path.resolve(tempRootDir, 'file1.txt');
    const request = { paths: [absolutePath] };
    const rawResult = await readContentToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBeUndefined();
    expect(result[0].error).toBeDefined();
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should return error for path traversal (caught by mock resolvePath)', async () => {
    const request = { paths: ['../outside.txt'] };
    const rawResult = await readContentToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBeUndefined();
    expect(result[0].error).toBeDefined();
    expect(result[0].error).toMatch(/Mocked Path traversal detected/);
  });

  it('should reject requests with empty paths array based on Zod schema', async () => {
    const request = { paths: [] };
    await expect(readContentToolDefinition.handler(request)).rejects.toThrow(
      McpError,
    );
    await expect(readContentToolDefinition.handler(request)).rejects.toThrow(
      /Paths array cannot be empty/,
    );
  });

  // Note: Testing binary file reading might require adjustments based on how
  // the handler returns binary content (e.g., base64 encoded string).
  // Assuming it returns utf8 string for now, which might corrupt binary data.
  it('should attempt to read binary files (result might be corrupted if not handled)', async () => {
    const request = {
      paths: ['binaryFile.bin'],
    };
    const rawResult = await readContentToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    const binaryFile = result[0];
    expect(binaryFile.error).toBeUndefined(); // Should be successful read attempt
    expect(binaryFile.content).toBeDefined();
    // The content will likely be garbled UTF-8 interpretation of binary data
    // Reading binary data as utf-8 might return garbled content, but the read itself should succeed.
    // We just check that an error wasn't returned and some content was.
    expect(binaryFile.error).toBeUndefined();
    expect(binaryFile.content).toBeDefined();
    // Optionally, check that the content is a string of expected length if the behavior is consistent
    // expect(binaryFile.content.length).toBe(4); // This seems to be the observed behavior
    expect(binaryFile.content).toBeDefined();
  });

  it('should handle unexpected errors during path resolution', async () => {
    const errorPath = 'resolveErrorPath.txt';
    const genericErrorMessage = 'Simulated generic resolve error';

    // Mock resolvePath to throw a generic Error for this path
    mockResolvePath.mockImplementationOnce((relativePath: string): string => {
      if (relativePath === errorPath) {
        throw new Error(genericErrorMessage);
      }
      // Fallback (might not be needed if only errorPath is requested)
      const absolutePath = path.resolve(tempRootDir, relativePath);
      if (!absolutePath.startsWith(tempRootDir))
        throw new McpError(ErrorCode.InvalidRequest, `Traversal`);
      if (path.isAbsolute(relativePath))
        throw new McpError(ErrorCode.InvalidParams, `Absolute`);
      return absolutePath;
    });

    const request = { paths: [errorPath] };
    const rawResult = await readContentToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    const errorResult = result.find((r: any) => r.path === errorPath);
    expect(errorResult).toBeDefined();
    expect(errorResult.content).toBeUndefined();
    expect(errorResult.error).toBeDefined();
    // Check for the unexpected resolve error message from line 82
    expect(errorResult.error).toMatch(
      // Corrected regex
      /Error resolving path: Simulated generic resolve error/,
    );
  });
});
