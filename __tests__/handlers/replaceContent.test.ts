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
const { replaceContentToolDefinition } = await import('../../src/handlers/replaceContent.js');

// Define the initial structure
const initialTestStructure = {
  'fileA.txt': 'Hello world, world!',
  'fileB.log': 'Error: world not found.\nWarning: world might be deprecated.',
  'noReplace.txt': 'Nothing to see here.',
  'dir1': {
    'fileC.txt': 'Another world inside dir1.',
  },
};

let tempRootDir: string;

describe('handleReplaceContent Integration Tests', () => {
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
        // For replace, we need the handler to read the file, so no existence check here.
        return absolutePath;
    });
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    vi.clearAllMocks(); // Clear all mocks
  });

  it('should replace simple text in specified files', async () => {
    const request = {
      paths: ['fileA.txt', 'fileB.log'],
      operations: [{ search: 'world', replace: 'planet' }],
    };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results; // Extract the results array

    expect(resultsArray).toHaveLength(2);
    // Check properties within the results array
    expect(resultsArray[0]).toEqual({ file: 'fileA.txt', modified: true, replacements: 2 });
    expect(resultsArray[1]).toEqual({ file: 'fileB.log', modified: true, replacements: 2 });

    // Verify replacements
    const contentA = await fsPromises.readFile(path.join(tempRootDir, 'fileA.txt'), 'utf-8');
    expect(contentA).toBe('Hello planet, planet!');
    const contentB = await fsPromises.readFile(path.join(tempRootDir, 'fileB.log'), 'utf-8');
    expect(contentB).toBe('Error: planet not found.\nWarning: planet might be deprecated.');
  });

  it('should handle multiple operations sequentially', async () => {
    const request = {
      paths: ['fileA.txt'],
      operations: [
        { search: 'world', replace: 'galaxy' }, // First replace world -> galaxy
        { search: 'galaxy', replace: 'universe' }, // Then replace galaxy -> universe
      ],
    };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results;

    expect(resultsArray).toHaveLength(1);
    // Total replacements should reflect the final state after all ops
    // Note: The handler seems to return 'file' not 'path', and 'modified' not 'success'
    expect(resultsArray[0]).toEqual({ file: 'fileA.txt', modified: true, replacements: 4 }); // 2 replacements in op1, 2 in op2

    // Verify final content
    const contentA = await fsPromises.readFile(path.join(tempRootDir, 'fileA.txt'), 'utf-8');
    expect(contentA).toBe('Hello universe, universe!');
  });

  it('should use regex for replacement', async () => {
    const request = {
      paths: ['fileB.log'],
      operations: [{ search: '^(Error|Warning):', replace: 'Log[$1]:', use_regex: true }],
    };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results;

    expect(resultsArray).toHaveLength(1);
    // Check actual properties
    expect(resultsArray[0]).toEqual({ file: 'fileB.log', modified: true, replacements: 2 }); // Regex should now replace both Error and Warning with 'm' flag added

    // Verify regex replacement
    const contentB = await fsPromises.readFile(path.join(tempRootDir, 'fileB.log'), 'utf-8');
    expect(contentB).toBe('Log[Error]: world not found.\nLog[Warning]: world might be deprecated.');
  });

  it('should handle case-insensitive replacement', async () => {
     const request = {
       paths: ['fileA.txt'],
       operations: [{ search: 'hello', replace: 'Greetings', ignore_case: true }],
     };
     const rawResult = await replaceContentToolDefinition.handler(request);
     const parsedResult = JSON.parse(rawResult.content[0].text);
     const resultsArray = parsedResult.results;

     expect(resultsArray).toHaveLength(1);
     expect(resultsArray[0]).toEqual({ file: 'fileA.txt', modified: true, replacements: 1 });

     // Verify replacement
     const contentA = await fsPromises.readFile(path.join(tempRootDir, 'fileA.txt'), 'utf-8');
     expect(contentA).toBe('Greetings world, world!');
   });


  it('should report 0 replacements if search term not found', async () => {
    const request = {
      paths: ['noReplace.txt'],
      operations: [{ search: 'world', replace: 'planet' }],
    };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results;

    expect(resultsArray).toHaveLength(1);
    expect(resultsArray[0]).toEqual({ file: 'noReplace.txt', modified: false, replacements: 0 });

    // Verify content unchanged
    const content = await fsPromises.readFile(path.join(tempRootDir, 'noReplace.txt'), 'utf-8');
    expect(content).toBe('Nothing to see here.');
  });

  it('should return error if path does not exist', async () => {
    const request = {
      paths: ['nonexistent.txt'],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results;

    expect(resultsArray).toHaveLength(1);
    expect(resultsArray[0].modified).toBe(false); // Check modified flag
    expect(resultsArray[0].error).toMatch(/File not found/); // Match actual error
  });

  it('should return error if path is a directory', async () => {
     const request = {
       paths: ['dir1'],
       operations: [{ search: 'a', replace: 'b' }],
     };
     const rawResult = await replaceContentToolDefinition.handler(request);
     const parsedResult = JSON.parse(rawResult.content[0].text);
     const resultsArray = parsedResult.results;

     expect(resultsArray).toHaveLength(1);
     expect(resultsArray[0].modified).toBe(false);
     expect(resultsArray[0].error).toMatch(/Path is not a file/); // Match actual error
   });


  it('should handle mixed success and failure paths', async () => {
    const request = {
      paths: ['fileA.txt', 'nonexistent.txt', 'dir1'],
      operations: [{ search: 'world', replace: 'sphere' }],
    };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results;

    expect(resultsArray).toHaveLength(3);

    const successA = resultsArray.find((r: any) => r.file === 'fileA.txt');
    expect(successA).toEqual({ file: 'fileA.txt', modified: true, replacements: 2 });

    const failNonExist = resultsArray.find((r: any) => r.file === 'nonexistent.txt');
    expect(failNonExist.modified).toBe(false);
    expect(failNonExist.error).toMatch(/File not found/);

    const failDir = resultsArray.find((r: any) => r.file === 'dir1');
    expect(failDir.modified).toBe(false);
    expect(failDir.error).toMatch(/Path is not a file/);

    // Verify successful replacement
    const contentA = await fsPromises.readFile(path.join(tempRootDir, 'fileA.txt'), 'utf-8');
    expect(contentA).toBe('Hello sphere, sphere!');
  });

  it('should return error for absolute path (caught by mock resolvePath)', async () => {
    const absolutePath = path.resolve(tempRootDir, 'fileA.txt');
    const request = { paths: [absolutePath], operations: [{ search: 'a', replace: 'b' }] };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results;
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray[0].modified).toBe(false);
    expect(resultsArray[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should return error for path traversal (caught by mock resolvePath)', async () => {
    const request = { paths: ['../outside.txt'], operations: [{ search: 'a', replace: 'b' }] };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results;
    expect(resultsArray).toHaveLength(1);
    expect(resultsArray[0].modified).toBe(false);
    expect(resultsArray[0].error).toMatch(/Mocked Path traversal detected/);
  });

  it('should reject requests with empty paths array based on Zod schema', async () => {
    const request = { paths: [], operations: [{ search: 'a', replace: 'b' }] };
    await expect(replaceContentToolDefinition.handler(request)).rejects.toThrow(McpError);
    await expect(replaceContentToolDefinition.handler(request)).rejects.toThrow(/Paths array cannot be empty/);
  });

  it('should reject requests with empty operations array based on Zod schema', async () => {
    const request = { paths: ['fileA.txt'], operations: [] };
    await expect(replaceContentToolDefinition.handler(request)).rejects.toThrow(McpError);
    await expect(replaceContentToolDefinition.handler(request)).rejects.toThrow(/Operations array cannot be empty/);
  });


  it('should handle McpError during path resolution', async () => {
    const request = {
      paths: ['../traversal.txt'], // Path that triggers McpError in mockResolvePath
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results;

    expect(resultsArray).toHaveLength(1);
    expect(resultsArray[0].modified).toBe(false);
    expect(resultsArray[0].error).toMatch(/Mocked Path traversal detected/); // Check for McpError message
  });

  it('should handle generic errors during path resolution or fs operations', async () => {
    const errorPath = 'genericErrorFile.txt';
    const genericErrorMessage = 'Simulated generic error';

    // Mock resolvePath to throw a generic Error for this path
    mockResolvePath.mockImplementationOnce((relativePath: string): string => {
      if (relativePath === errorPath) {
        throw new Error(genericErrorMessage);
      }
      // Fallback for other paths
      const absolutePath = path.resolve(tempRootDir, relativePath);
      if (!absolutePath.startsWith(tempRootDir)) throw new McpError(ErrorCode.InvalidRequest, `Traversal`);
      if (path.isAbsolute(relativePath)) throw new McpError(ErrorCode.InvalidParams, `Absolute`);
      return absolutePath;
    });

    const request = {
      paths: [errorPath],
      operations: [{ search: 'a', replace: 'b' }],
    };
    const rawResult = await replaceContentToolDefinition.handler(request);
    const parsedResult = JSON.parse(rawResult.content[0].text);
    const resultsArray = parsedResult.results;

    expect(resultsArray).toHaveLength(1);
    expect(resultsArray[0].modified).toBe(false);
    // Check for the generic error message from line 111
    expect(resultsArray[0].error).toMatch(/Failed to process file: Simulated generic error/);
  });

});