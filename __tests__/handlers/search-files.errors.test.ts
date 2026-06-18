import { describe, it, expect, vi } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  handleSearchFilesFunc,
  searchFilesToolDefinition,
  type SearchFilesDependencies,
} from '../../src/handlers/search-files.js';

// Drives the dependency-injected core to reach the regex-compilation,
// glob-failure, per-file read-error (ENOENT-silent vs reported), and
// whole-search error branches.

function makeDeps(overrides: Partial<SearchFilesDependencies> = {}): SearchFilesDependencies {
  return {
    readFile: vi.fn().mockResolvedValue('') as never,
    glob: vi.fn().mockResolvedValue([]) as never,
    resolvePath: vi.fn(async (p: string) => `/project-root/${p}`) as never,
    PROJECT_ROOT: '/project-root',
    pathRelative: (_from: string, to: string) => to.replace('/project-root/', '') as never,
    pathJoin: (...parts: string[]) => parts.join('/'),
    ...overrides,
  };
}

const parseResults = async (deps: SearchFilesDependencies, args: unknown) => {
  const res = await handleSearchFilesFunc(deps, args);
  return JSON.parse(res.content[0].text).results;
};

describe('search-files error and edge branches', () => {
  it('returns matches with surrounding context for a hit', async () => {
    const deps = makeDeps({
      glob: vi.fn().mockResolvedValue(['/project-root/a.txt']) as never,
      readFile: vi.fn().mockResolvedValue('one\ntwo\nNEEDLE\nfour\nfive') as never,
    });
    const results = await parseResults(deps, { regex: 'NEEDLE' });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: 'match', file: 'a.txt', line: 3, match: 'NEEDLE' });
    expect(results[0].context).toContain('NEEDLE');
  });

  it('parses an inline /pattern/flags regex string', async () => {
    const deps = makeDeps({
      glob: vi.fn().mockResolvedValue(['/project-root/a.txt']) as never,
      readFile: vi.fn().mockResolvedValue('Foo foo FOO') as never,
    });
    const results = await parseResults(deps, { regex: '/foo/i' });
    // Case-insensitive global match finds all three.
    expect(results.filter((r: { type: string }) => r.type === 'match')).toHaveLength(3);
  });

  it('throws an McpError for an invalid regex', async () => {
    await expect(handleSearchFilesFunc(makeDeps(), { regex: '(' })).rejects.toBeInstanceOf(
      McpError,
    );
  });

  it('throws an McpError when glob fails', async () => {
    const deps = makeDeps({
      glob: vi.fn().mockRejectedValue(new Error('glob exploded')) as never,
    });
    await expect(handleSearchFilesFunc(deps, { regex: 'x' })).rejects.toThrow(
      /Failed to find files using glob/,
    );
  });

  it('silently skips a file that disappears (ENOENT) between glob and read', async () => {
    const deps = makeDeps({
      glob: vi.fn().mockResolvedValue(['/project-root/gone.txt']) as never,
      readFile: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' })) as never,
    });
    const results = await parseResults(deps, { regex: 'x' });
    // The ENOENT branch returns an empty-file error item that carries no message.
    expect(results.every((r: { error?: string }) => !r.error)).toBe(true);
  });

  it('reports a non-ENOENT read error as a per-file error item', async () => {
    const deps = makeDeps({
      glob: vi.fn().mockResolvedValue(['/project-root/locked.txt']) as never,
      readFile: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' })) as never,
    });
    const results = await parseResults(deps, { regex: 'x' });
    const errItem = results.find((r: { type: string }) => r.type === 'error');
    expect(errItem.file).toBe('locked.txt');
    expect(errItem.error).toBe('Read/Process Error: denied');
  });

  it('collects a general error when an McpError-free failure escapes the search loop', async () => {
    // glob resolves a file, but searchFileContent throws a non-McpError via a
    // broken pathRelative -- the outer catch records a "general" error item.
    const deps = makeDeps({
      glob: vi.fn().mockResolvedValue(['/project-root/a.txt']) as never,
      pathRelative: (() => {
        throw new Error('relative blew up');
      }) as never,
    });
    const results = await parseResults(deps, { regex: 'x' });
    const general = results.find((r: { file: string }) => r.file === 'general');
    expect(general).toBeDefined();
    expect(general.error).toBe('relative blew up');
  });

  it('rejects an empty regex via the real-deps wrapper', async () => {
    await expect(searchFilesToolDefinition.handler({ regex: '' })).rejects.toBeInstanceOf(McpError);
  });
});
