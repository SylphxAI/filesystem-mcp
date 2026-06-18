import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock fs.rm and resolvePath so every error-classification branch in
// getErrorMessage / handleDeleteError is reachable deterministically.
vi.mock('node:fs', () => ({
  promises: {
    rm: vi.fn().mockName('fs.rm'),
  },
}));

vi.mock('../../src/utils/path-utils.js', () => ({
  resolvePath: vi.fn().mockName('pathUtils.resolvePath'),
  PROJECT_ROOT: '/project-root',
}));

describe('delete-items error branches', () => {
  let handler: (args: unknown) => Promise<{ content: { text: string }[] }>;
  let rm: ReturnType<typeof vi.fn>;
  let resolvePath: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    rm = (await import('node:fs')).promises.rm as never;
    resolvePath = (await import('../../src/utils/path-utils.js')).resolvePath as never;
    vi.resetAllMocks();
    resolvePath.mockImplementation((p: string) => `/project-root/sub/${p}`);
    rm.mockResolvedValue(undefined);
    const { deleteItemsToolDefinition } = await import('../../src/handlers/delete-items.js');
    handler = deleteItemsToolDefinition.handler;
  });

  const firstResult = async (args: unknown) => {
    const res = await handler(args);
    return JSON.parse(res.content[0].text)[0];
  };

  it('reports success for a normal delete', async () => {
    const r = await firstResult({ paths: ['a.txt'] });
    expect(r).toMatchObject({ path: 'a.txt', success: true });
  });

  it('treats ENOENT as success with a "nothing to delete" note', async () => {
    rm.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }));
    const r = await firstResult({ paths: ['ghost.txt'] });
    expect(r.success).toBe(true);
    expect(r.note).toBe('Path not found, nothing to delete');
  });

  it('maps EPERM to a permission-denied failure', async () => {
    rm.mockRejectedValue(Object.assign(new Error('x'), { code: 'EPERM' }));
    const r = await firstResult({ paths: ['locked.txt'] });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Permission denied deleting locked.txt');
  });

  it('maps EACCES to a permission-denied failure', async () => {
    rm.mockRejectedValue(Object.assign(new Error('x'), { code: 'EACCES' }));
    const r = await firstResult({ paths: ['locked.txt'] });
    expect(r.error).toMatch(/Permission denied deleting/);
  });

  it('includes the code for a generic coded error', async () => {
    rm.mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }));
    const r = await firstResult({ paths: ['busy.txt'] });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Failed to delete busy.txt: busy (code: EBUSY)');
  });

  it('handles an Error without a code', async () => {
    rm.mockRejectedValue(new Error('plain failure'));
    const r = await firstResult({ paths: ['x.txt'] });
    expect(r.error).toBe('Failed to delete x.txt: plain failure');
  });

  it('stringifies a non-Error rejection', async () => {
    rm.mockRejectedValue('weird string');
    const r = await firstResult({ paths: ['x.txt'] });
    expect(r.error).toBe('Failed to delete x.txt: weird string');
  });

  it('passes an McpError message through (from resolvePath)', async () => {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    resolvePath.mockImplementationOnce(() => {
      throw new McpError(ErrorCode.InvalidRequest, 'traversal detected');
    });
    const r = await firstResult({ paths: ['../escape.txt'] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/traversal detected/);
  });

  it('refuses to delete the project root itself', async () => {
    resolvePath.mockImplementationOnce(() => '/project-root');
    const r = await firstResult({ paths: ['.'] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Deleting the project root is not allowed/);
  });

  it('rejects an empty paths array via the schema', async () => {
    const { McpError } = await import('@modelcontextprotocol/sdk/types.js');
    await expect(handler({ paths: [] })).rejects.toBeInstanceOf(McpError);
  });
});
