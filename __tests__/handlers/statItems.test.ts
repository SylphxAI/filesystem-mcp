import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'; // Add jest
import * as fsPromises from 'fs/promises';
import * as path from 'path';
// Import the definition object - will be mocked later
// import { statItemsToolDefinition } from '../../src/handlers/statItems.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'; // Match source import path
import { createTemporaryFilesystem, cleanupTemporaryFilesystem } from '../testUtils.js'; // Assuming a test utility exists, add .js extension

// Mock pathUtils BEFORE importing the handler that uses it
const mockResolvePath = jest.fn<(userPath: string) => string>(); // Add type hint for the mock function signature
jest.unstable_mockModule('../../src/utils/pathUtils.js', () => ({
    // Keep original PROJECT_ROOT if needed elsewhere, but override resolvePath
    PROJECT_ROOT: 'mocked/project/root', // Or keep original: jest.requireActual('../../src/utils/pathUtils.js').PROJECT_ROOT,
    resolvePath: mockResolvePath,
}));

// Now import the handler AFTER the mock is set up
const { statItemsToolDefinition } = await import('../../src/handlers/statItems.js');


// Define the structure for the temporary filesystem
const testStructure = {
  'file1.txt': 'content1',
  'dir1': {
    'file2.js': 'content2',
  },
  'emptyDir': {},
};

let tempRootDir: string;
// let originalCwd: string; // No longer needed

describe('handleStatItems Integration Tests', () => {
  beforeEach(async () => {
    // originalCwd = process.cwd(); // No longer needed
    tempRootDir = await createTemporaryFilesystem(testStructure);

    // Configure the mock resolvePath for this test run
    // Add explicit return type to the implementation function for clarity, although the fix is mainly in jest.fn()
    mockResolvePath.mockImplementation((relativePath: string): string => {
        const absolutePath = path.resolve(tempRootDir, relativePath);
        // Basic security check simulation (can be enhanced if needed)
        if (!absolutePath.startsWith(tempRootDir)) {
            throw new McpError(ErrorCode.InvalidRequest, `Mocked Path traversal detected for ${relativePath}`);
        }
        // Simulate absolute path rejection
        if (path.isAbsolute(relativePath)) {
             throw new McpError(ErrorCode.InvalidParams, `Mocked Absolute paths are not allowed for ${relativePath}`);
        }
        return absolutePath;
    });
  });

  afterEach(async () => {
    // Change CWD back - No longer needed
    // process.chdir(originalCwd);
    await cleanupTemporaryFilesystem(tempRootDir);
    mockResolvePath.mockClear(); // Clear mock calls between tests
  });

  it('should return stats for existing files and directories', async () => {
    const request = {
      paths: ['file1.txt', 'dir1', 'dir1/file2.js', 'emptyDir'],
    };
    // Use the handler from the imported definition
    const rawResult = await statItemsToolDefinition.handler(request);
    // Assuming the handler returns { content: [{ type: 'text', text: JSON.stringify(results) }] }
    const result = JSON.parse(rawResult.content[0].text);


    expect(result).toHaveLength(4);

    // Basic checks - adjust based on actual result structure from handler
    const file1Stat = result.find((r: any) => r.path === 'file1.txt');
    expect(file1Stat).toBeDefined(); // Ensure the item was found
    expect(file1Stat?.status).toBe('success');
    expect(file1Stat?.stats?.isFile).toBe(true);
    expect(file1Stat?.stats?.isDirectory).toBe(false);
    expect(file1Stat?.stats?.size).toBe(Buffer.byteLength('content1'));

    const dir1Stat = result.find((r: any) => r.path === 'dir1');
    expect(dir1Stat).toBeDefined();
    expect(dir1Stat?.status).toBe('success');
    expect(dir1Stat?.stats?.isFile).toBe(false);
    expect(dir1Stat?.stats?.isDirectory).toBe(true);

    const file2Stat = result.find((r: any) => r.path === 'dir1/file2.js');
    expect(file2Stat).toBeDefined();
    expect(file2Stat?.status).toBe('success');
    expect(file2Stat?.stats?.isFile).toBe(true);
    expect(file2Stat?.stats?.size).toBe(Buffer.byteLength('content2'));

    const emptyDirStat = result.find((r: any) => r.path === 'emptyDir');
    expect(emptyDirStat).toBeDefined();
    expect(emptyDirStat?.status).toBe('success');
    expect(emptyDirStat?.stats?.isDirectory).toBe(true);
  });

  it('should return errors for non-existent paths', async () => {
    const request = {
      paths: ['file1.txt', 'nonexistent.file', 'dir1/nonexistent.js'],
    };
    const rawResult = await statItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(3);

    const file1Stat = result.find((r: any) => r.path === 'file1.txt');
    expect(file1Stat).toBeDefined();
    expect(file1Stat?.status).toBe('success');

    const nonexistentFile = result.find((r: any) => r.path === 'nonexistent.file');
    expect(nonexistentFile).toBeDefined();
    expect(nonexistentFile?.status).toBe('error');
    // The handler currently returns a simple string message, not an McpError object directly in the result array
    expect(nonexistentFile?.error).toBe('Path not found');
    // The handler returns a simple string message for ENOENT
    expect(nonexistentFile?.error).toBe('Path not found');

    const nonexistentJs = result.find((r: any) => r.path === 'dir1/nonexistent.js');
    expect(nonexistentJs).toBeDefined();
    expect(nonexistentJs?.status).toBe('error');
    expect(nonexistentJs?.error).toBe('Path not found');
  });

  it('should return error for absolute paths (caught by mock resolvePath)', async () => {
    // Use a path that path.isAbsolute will detect, even if it's within the temp dir conceptually
    const absolutePath = path.resolve(tempRootDir, 'file1.txt');
    const request = {
      paths: [absolutePath], // Pass the absolute path directly
    };

    // Our mock resolvePath will throw an McpError when it sees an absolute path
    const rawResult = await statItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('error');
    // Check the error message generated by our mock
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should return error for path traversal (caught by mock resolvePath)', async () => {
    const request = {
      paths: ['../outside.txt'],
    };

    // The handler now catches McpErrors from resolvePath and returns them in the result array
    const rawResult = await statItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('error');
    expect(result[0].error).toMatch(/Path traversal detected/);
  });

  it('should handle an empty paths array gracefully', async () => {
    // The Zod schema has .min(1), so this should throw an InvalidParams error
    const request = {
      paths: [],
    };
    await expect(statItemsToolDefinition.handler(request)).rejects.toThrow(McpError);
    await expect(statItemsToolDefinition.handler(request)).rejects.toThrow(/Paths array cannot be empty/);
  });
});

// Placeholder for testUtils - needs actual implementation
// You might need to create a __tests__/testUtils.ts file
/*
async function createTemporaryFilesystem(structure: any, currentPath = process.cwd()): Promise<string> {
  const tempDir = await fsPromises.mkdtemp(path.join(currentPath, 'jest-statitems-test-'));
  await createStructureRecursively(structure, tempDir);
  return tempDir;
}

async function createStructureRecursively(structure: any, currentPath: string): Promise<void> {
  for (const name in structure) {
    const itemPath = path.join(currentPath, name);
    const content = structure[name];
    if (typeof content === 'string') {
      await fsPromises.writeFile(itemPath, content);
    } else if (typeof content === 'object' && content !== null) {
      await fsPromises.mkdir(itemPath);
      await createStructureRecursively(content, itemPath);
    }
  }
}


async function cleanupTemporaryFilesystem(dirPath: string): Promise<void> {
  await fsPromises.rm(dirPath, { recursive: true, force: true });
}
*/