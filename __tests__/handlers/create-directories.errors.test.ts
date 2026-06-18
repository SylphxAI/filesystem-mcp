import { describe, it, expect, vi } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  handleCreateDirectoriesInternal,
  createDirectoriesToolDefinition,
  type CreateDirsDeps,
} from '../../src/handlers/create-directories.js';

// Drives the dependency-injected core to reach the EEXIST handling, the
// permission/McpError/generic creation-error branches, and the project-root
// guard. The wrapper path is exercised through the real-deps tool definition.

function makeDeps(overrides: Partial<CreateDirsDeps> = {}): CreateDirsDeps {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined) as never,
    stat: vi.fn() as never,
    resolvePath: vi.fn((p: string) => `/project-root/sub/${p}`) as never,
    PROJECT_ROOT: '/project-root',
    ...overrides,
  };
}

const firstResult = async (deps: CreateDirsDeps, args: unknown) => {
  const res = await handleCreateDirectoriesInternal(args, deps);
  return JSON.parse(res.content[0].text)[0];
};

const dirStat = (isDir: boolean) => ({ isDirectory: () => isDir });

describe('create-directories error and edge branches', () => {
  it('creates a directory successfully', async () => {
    const r = await firstResult(makeDeps(), { paths: ['new-dir'] });
    expect(r).toMatchObject({ path: 'new-dir', success: true });
  });

  it('treats EEXIST on a real directory as "already exists"', async () => {
    const deps = makeDeps({
      mkdir: vi.fn().mockRejectedValue(Object.assign(new Error('e'), { code: 'EEXIST' })) as never,
      stat: vi.fn().mockResolvedValue(dirStat(true)) as never,
    });
    const r = await firstResult(deps, { paths: ['existing'] });
    expect(r.success).toBe(true);
    expect(r.note).toBe('Directory already exists');
  });

  it('reports EEXIST on a non-directory as a failure', async () => {
    const deps = makeDeps({
      mkdir: vi.fn().mockRejectedValue(Object.assign(new Error('e'), { code: 'EEXIST' })) as never,
      stat: vi.fn().mockResolvedValue(dirStat(false)) as never,
    });
    const r = await firstResult(deps, { paths: ['afile'] });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Path exists but is not a directory');
  });

  it('reports a stat failure while resolving an EEXIST collision', async () => {
    const deps = makeDeps({
      mkdir: vi.fn().mockRejectedValue(Object.assign(new Error('e'), { code: 'EEXIST' })) as never,
      stat: vi.fn().mockRejectedValue(new Error('stat broke')) as never,
    });
    const r = await firstResult(deps, { paths: ['weird'] });
    expect(r.error).toBe('Failed to stat existing path: stat broke');
  });

  it('maps EPERM to a permission-denied creation error', async () => {
    const deps = makeDeps({
      mkdir: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('nope'), { code: 'EPERM' })) as never,
    });
    const r = await firstResult(deps, { paths: ['locked'] });
    expect(r.error).toBe('Permission denied creating directory: nope');
  });

  it('wraps a generic mkdir failure', async () => {
    const deps = makeDeps({
      mkdir: vi.fn().mockRejectedValue(new Error('disk full')) as never,
    });
    const r = await firstResult(deps, { paths: ['x'] });
    expect(r.error).toBe('Failed to create directory: disk full');
  });

  it('returns an McpError message from resolvePath verbatim', async () => {
    const deps = makeDeps({
      resolvePath: vi.fn(() => {
        throw new McpError(ErrorCode.InvalidRequest, 'traversal blocked');
      }) as never,
    });
    const r = await firstResult(deps, { paths: ['../x'] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/traversal blocked/);
    expect(r.resolvedPath).toBe('Resolution failed');
  });

  it('refuses to create the project root', async () => {
    const deps = makeDeps({ resolvePath: vi.fn(() => '/project-root') as never });
    const r = await firstResult(deps, { paths: ['.'] });
    expect(r.error).toBe('Creating the project root is not allowed.');
  });

  it('rejects an empty paths array via the real-deps wrapper', async () => {
    await expect(createDirectoriesToolDefinition.handler({ paths: [] })).rejects.toBeInstanceOf(
      McpError,
    );
  });

  it('wraps a non-Zod validation failure as an McpError', async () => {
    // A non-array `paths` triggers a Zod error -> InvalidParams McpError.
    await expect(
      handleCreateDirectoriesInternal({ paths: 'not-an-array' }, makeDeps()),
    ).rejects.toBeInstanceOf(McpError);
  });
});
