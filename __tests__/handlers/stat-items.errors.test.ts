import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock fs.stat and resolvePath so the error-mapping branches in handleStatError
// (ENOENT / EACCES / EPERM / generic) and the rejected-settled branch are all
// reachable deterministically.
vi.mock('node:fs', () => ({
  promises: {
    stat: vi.fn().mockName('fs.stat'),
  },
}));

vi.mock('../../src/utils/path-utils', () => ({
  resolvePath: vi.fn().mockName('pathUtils.resolvePath'),
  PROJECT_ROOT: '/project-root',
}));

describe('stat-items error branches', () => {
  let handler: (args: unknown) => Promise<{ content: { text: string }[] }>;
  let fsMock: { stat: ReturnType<typeof vi.fn> };
  let resolvePath: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fsMock = (await import('node:fs')).promises as never;
    resolvePath = (await import('../../src/utils/path-utils')).resolvePath as never;
    vi.resetAllMocks();
    resolvePath.mockImplementation((p: string) => `/project-root/${p}`);
    const { statItemsToolDefinition } = await import('../../src/handlers/stat-items');
    handler = statItemsToolDefinition.handler;
  });

  const firstResult = async (args: unknown) => {
    const res = await handler(args);
    return JSON.parse(res.content[0].text)[0];
  };

  it('maps ENOENT to a "Path not found" error', async () => {
    fsMock.stat.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    const r = await firstResult({ paths: ['missing.txt'] });
    expect(r.status).toBe('error');
    expect(r.error).toBe('Path not found');
  });

  it('maps EACCES to a permission-denied error including the path', async () => {
    fsMock.stat.mockRejectedValue(Object.assign(new Error('x'), { code: 'EACCES' }));
    const r = await firstResult({ paths: ['locked.txt'] });
    expect(r.error).toBe('Permission denied stating path: locked.txt');
  });

  it('maps EPERM to a permission-denied error', async () => {
    fsMock.stat.mockRejectedValue(Object.assign(new Error('x'), { code: 'EPERM' }));
    const r = await firstResult({ paths: ['locked.txt'] });
    expect(r.error).toMatch(/Permission denied stating path/);
  });

  it('falls back to a generic "Failed to get stats" message for an uncoded error', async () => {
    fsMock.stat.mockRejectedValue(new Error('disk on fire'));
    const r = await firstResult({ paths: ['weird.txt'] });
    expect(r.error).toBe('Failed to get stats: disk on fire');
  });

  it('passes an McpError message straight through (resolvePath rejection)', async () => {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    resolvePath.mockRejectedValueOnce(new McpError(ErrorCode.InvalidParams, 'bad path'));
    const r = await firstResult({ paths: ['../escape'] });
    // handleStatError returns the McpError's .message verbatim; the SDK prefixes
    // it with "MCP error <code>: ", so the original text is preserved within it.
    expect(r.error).toMatch(/bad path/);
    expect(r.error).not.toMatch(/Failed to get stats/);
  });

  it('stringifies a non-Error rejection in the generic branch', async () => {
    fsMock.stat.mockRejectedValue('plain string failure');
    const r = await firstResult({ paths: ['weird.txt'] });
    expect(r.error).toBe('Failed to get stats: plain string failure');
  });

  it('rejects an empty paths array via the Zod schema', async () => {
    const { McpError } = await import('@modelcontextprotocol/sdk/types.js');
    await expect(handler({ paths: [] })).rejects.toBeInstanceOf(McpError);
  });
});
