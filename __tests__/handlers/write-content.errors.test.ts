import { describe, it, expect, vi } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  handleWriteContentFunc,
  writeContentToolDefinition,
  type WriteContentDependencies,
} from '../../src/handlers/write-content.js';

// Drives the dependency-injected core directly to reach the error and append
// branches, plus the toolDefinition wrapper that wires the real fs deps.

function makeDeps(overrides: Partial<WriteContentDependencies> = {}): WriteContentDependencies {
  return {
    writeFile: vi.fn().mockResolvedValue(undefined) as never,
    appendFile: vi.fn().mockResolvedValue(undefined) as never,
    mkdir: vi.fn().mockResolvedValue(undefined) as never,
    stat: vi.fn() as never,
    resolvePath: vi.fn((p: string) => `/root/${p}`) as never,
    PROJECT_ROOT: '/root',
    pathDirname: (p: string) => p.split('/').slice(0, -1).join('/') || '/',
    ...overrides,
  };
}

const firstResult = async (deps: WriteContentDependencies, args: unknown) => {
  const res = await handleWriteContentFunc(deps, args);
  return JSON.parse(res.content[0].text)[0];
};

describe('write-content error and append branches', () => {
  it('appends content and reports the "appended" operation', async () => {
    const appendFile = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendFile: appendFile as never });
    const r = await firstResult(deps, {
      items: [{ path: 'log.txt', content: 'more', append: true }],
    });
    expect(r).toMatchObject({ path: 'log.txt', success: true, operation: 'appended' });
    expect(appendFile).toHaveBeenCalledWith('/root/log.txt', 'more', 'utf-8');
  });

  it('refuses to write directly to the project root', async () => {
    const deps = makeDeps({ resolvePath: vi.fn(() => '/root') as never });
    const r = await firstResult(deps, { items: [{ path: '.', content: 'x' }] });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Writing directly to the project root is not allowed.');
  });

  it('returns an McpError message verbatim from resolvePath', async () => {
    const deps = makeDeps({
      resolvePath: vi.fn(() => {
        throw new McpError(ErrorCode.InvalidRequest, 'traversal blocked');
      }) as never,
    });
    const r = await firstResult(deps, { items: [{ path: '../x', content: 'x' }] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/traversal blocked/);
  });

  it('wraps a generic write failure with the operation verb', async () => {
    const deps = makeDeps({
      writeFile: vi.fn().mockRejectedValue(new Error('disk full')) as never,
    });
    const r = await firstResult(deps, { items: [{ path: 'a.txt', content: 'x' }] });
    expect(r.error).toBe('Failed to write file: disk full');
  });

  it('wraps a generic append failure with the append verb', async () => {
    const deps = makeDeps({
      appendFile: vi.fn().mockRejectedValue(new Error('eof')) as never,
    });
    const r = await firstResult(deps, {
      items: [{ path: 'a.txt', content: 'x', append: true }],
    });
    expect(r.error).toBe('Failed to append file: eof');
  });

  it('stringifies a non-Error write rejection', async () => {
    const deps = makeDeps({
      writeFile: vi.fn().mockRejectedValue('weird non-error') as never,
    });
    const r = await firstResult(deps, { items: [{ path: 'a.txt', content: 'x' }] });
    expect(r.error).toBe('Failed to write file: weird non-error');
  });

  it('skips mkdir when the target directory is the project root', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    // resolvePath returns a path whose dirname equals PROJECT_ROOT.
    const deps = makeDeps({
      mkdir: mkdir as never,
      resolvePath: vi.fn(() => '/root/file.txt') as never,
    });
    await firstResult(deps, { items: [{ path: 'file.txt', content: 'x' }] });
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('rejects an empty items array via the schema (through the real wrapper)', async () => {
    await expect(writeContentToolDefinition.handler({ items: [] })).rejects.toBeInstanceOf(
      McpError,
    );
  });
});
