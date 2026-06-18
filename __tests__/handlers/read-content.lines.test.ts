import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createTemporaryFilesystem, cleanupTemporaryFilesystem } from '../test-utils.js';

// Covers the line-range and format branches plus the specific filesystem-error
// messages in read-content that the integration suite doesn't reach.

const mockResolvePath = vi.fn();
vi.mock('../../src/utils/path-utils.js', () => ({
  PROJECT_ROOT: 'mocked/project/root',
  resolvePath: mockResolvePath,
}));

const { readContentToolDefinition } = await import('../../src/handlers/read-content.js');

interface ReadResult {
  path: string;
  content?: string | { lineNumber: number; content: string }[];
  error?: string;
}

const multiLine = 'line1\nline2\nline3\nline4\nline5';
const testStructure = {
  'multi.txt': multiLine,
};

let tempRootDir: string;

async function run(args: unknown): Promise<ReadResult[]> {
  const raw = await readContentToolDefinition.handler(args);
  return JSON.parse(raw.content[0].text);
}

describe('read-content line ranges and error branches', () => {
  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(testStructure);
    mockResolvePath.mockImplementation((relativePath: string): string =>
      path.resolve(tempRootDir, relativePath),
    );
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    vi.clearAllMocks();
  });

  it('returns line objects for a range in the default "lines" format', async () => {
    const result = await run({ paths: ['multi.txt'], start_line: 2, end_line: 4 });
    expect(result).toHaveLength(1);
    const content = result[0].content as { lineNumber: number; content: string }[];
    expect(content).toEqual([
      { lineNumber: 2, content: 'line2' },
      { lineNumber: 3, content: 'line3' },
      { lineNumber: 4, content: 'line4' },
    ]);
  });

  it('returns a joined string for a range in "raw" format', async () => {
    const result = await run({
      paths: ['multi.txt'],
      start_line: 2,
      end_line: 3,
      format: 'raw',
    });
    expect(result[0].content).toBe('line2\nline3');
  });

  it('reads from start_line to end of file when end_line is omitted', async () => {
    const result = await run({ paths: ['multi.txt'], start_line: 4 });
    const content = result[0].content as { lineNumber: number; content: string }[];
    expect(content.map((c) => c.lineNumber)).toEqual([4, 5]);
  });

  it('reads from the top when only end_line is given', async () => {
    const result = await run({ paths: ['multi.txt'], end_line: 2, format: 'raw' });
    expect(result[0].content).toBe('line1\nline2');
  });

  it('clamps a start_line beyond EOF to an empty slice', async () => {
    const result = await run({ paths: ['multi.txt'], start_line: 99, format: 'raw' });
    expect(result[0].content).toBe('');
  });

  it('surfaces a "not a regular file" error for a directory (stat succeeds, isFile false)', async () => {
    // Point at the temp dir itself; fs.stat().isFile() is false.
    mockResolvePath.mockImplementationOnce(() => tempRootDir);
    const result = await run({ paths: ['somedir'] });
    expect(result[0].error).toMatch(/Path is not a regular file/);
  });

  it('maps a real ENOENT from fs into the resolved-path "File not found" message', async () => {
    // resolvePath succeeds, but the file does not exist on disk, so fs.stat
    // rejects with ENOENT and getSpecificFsErrorMessage formats it.
    const result = await run({ paths: ['does-not-exist.txt'] });
    expect(result[0].error).toMatch(/File not found at resolved path/);
    expect(result[0].error).toContain(path.resolve(tempRootDir, 'does-not-exist.txt'));
  });

  it('wraps a non-coded resolve failure as a generic "Error resolving path"', async () => {
    mockResolvePath.mockImplementationOnce((): string => {
      throw new McpError(ErrorCode.InvalidRequest, 'weird failure');
    });
    const result = await run({ paths: ['x.txt'] });
    expect(result[0].error).toMatch(/Error resolving path: .*weird failure/);
  });
});
