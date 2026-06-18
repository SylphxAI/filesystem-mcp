import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock fs.stat/readFile and resolvePath so the specific filesystem-error
// messages in getSpecificFsErrorMessage (EISDIR / EACCES / EPERM) and the
// basic-message fallbacks are reachable without relying on real OS errors.
vi.mock('node:fs', () => ({
  promises: {
    stat: vi.fn().mockName('fs.stat'),
    readFile: vi.fn().mockName('fs.readFile'),
  },
}));

vi.mock('../../src/utils/path-utils.js', () => ({
  resolvePath: vi.fn().mockName('pathUtils.resolvePath'),
  PROJECT_ROOT: '/project-root',
}));

const isFileStat = (isFile: boolean) => ({ isFile: () => isFile });

describe('read-content filesystem-error branches', () => {
  let handler: (args: unknown) => Promise<{ content: { text: string }[] }>;
  let fsMock: { stat: ReturnType<typeof vi.fn>; readFile: ReturnType<typeof vi.fn> };
  let resolvePath: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fsMock = (await import('node:fs')).promises as never;
    resolvePath = (await import('../../src/utils/path-utils.js')).resolvePath as never;
    vi.resetAllMocks();
    resolvePath.mockImplementation((p: string) => `/project-root/${p}`);
    fsMock.stat.mockResolvedValue(isFileStat(true));
    const { readContentToolDefinition } = await import('../../src/handlers/read-content.js');
    handler = readContentToolDefinition.handler;
  });

  const firstError = async (args: unknown) => {
    const res = await handler(args);
    return JSON.parse(res.content[0].text)[0].error as string;
  };

  it('maps EISDIR to a "Path is a directory" message with the relative path', async () => {
    fsMock.stat.mockRejectedValue(Object.assign(new Error('x'), { code: 'EISDIR' }));
    expect(await firstError({ paths: ['somedir'] })).toBe(
      'Path is a directory, not a file: somedir',
    );
  });

  it('maps EACCES to a permission-denied read message', async () => {
    fsMock.stat.mockRejectedValue(Object.assign(new Error('x'), { code: 'EACCES' }));
    expect(await firstError({ paths: ['locked.txt'] })).toBe(
      'Permission denied reading file: locked.txt',
    );
  });

  it('maps EPERM to a permission-denied read message', async () => {
    fsMock.stat.mockRejectedValue(Object.assign(new Error('x'), { code: 'EPERM' }));
    expect(await firstError({ paths: ['locked.txt'] })).toMatch(/Permission denied reading file/);
  });

  it('falls back to a basic filesystem-error message for an unknown code', async () => {
    fsMock.stat.mockRejectedValue(Object.assign(new Error('weird'), { code: 'EBUSY' }));
    expect(await firstError({ paths: ['busy.txt'] })).toBe('Filesystem error: weird');
  });

  it('falls back to a basic message for a non-object rejection', async () => {
    fsMock.stat.mockRejectedValue('totally not an error object');
    expect(await firstError({ paths: ['weird.txt'] })).toBe(
      'Filesystem error: totally not an error object',
    );
  });

  it('returns ENOENT "File not found" with the resolved target path', async () => {
    fsMock.stat.mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }));
    const err = await firstError({ paths: ['gone.txt'] });
    expect(err).toMatch(/File not found at resolved path '\/project-root\/gone.txt'/);
    expect(err).toContain("from relative path 'gone.txt'");
  });

  it('reads the whole file when no line range is given', async () => {
    fsMock.stat.mockResolvedValue(isFileStat(true));
    fsMock.readFile.mockResolvedValue('full body');
    const res = await handler({ paths: ['whole.txt'] });
    const parsed = JSON.parse(res.content[0].text)[0];
    expect(parsed.content).toBe('full body');
    expect(parsed.error).toBeUndefined();
  });
});
