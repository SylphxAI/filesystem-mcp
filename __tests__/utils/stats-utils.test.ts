import { describe, it, expect } from 'vitest';
import { formatStats, FormattedStats } from '../../src/utils/stats-utils';

function makeMockStats(partial: Partial<Record<keyof FormattedStats, any>> = {}): any {
  // Provide default values and allow overrides
  return {
    isFile: () => partial.isFile ?? true,
    isDirectory: () => partial.isDirectory ?? false,
    isSymbolicLink: () => partial.isSymbolicLink ?? false,
    size: partial.size ?? 1234,
    atime: partial.atime ?? new Date('2024-01-01T01:02:03.000Z'),
    mtime: partial.mtime ?? new Date('2024-01-02T01:02:03.000Z'),
    ctime: partial.ctime ?? new Date('2024-01-03T01:02:03.000Z'),
    birthtime: partial.birthtime ?? new Date('2024-01-04T01:02:03.000Z'),
    mode: partial.mode ?? 0o755,
    uid: partial.uid ?? 1000,
    gid: partial.gid ?? 1000,
  };
}

describe('formatStats', () => {
  it('formats a regular file', () => {
    const stats = makeMockStats({ isFile: true, isDirectory: false, isSymbolicLink: false, mode: 0o644 });
    const result = formatStats('foo\\bar.txt', '/abs/foo/bar.txt', stats as any);
    expect(result).toEqual({
      path: 'foo/bar.txt',
      isFile: true,
      isDirectory: false,
      isSymbolicLink: false,
      size: 1234,
      atime: '2024-01-01T01:02:03.000Z',
      mtime: '2024-01-02T01:02:03.000Z',
      ctime: '2024-01-03T01:02:03.000Z',
      birthtime: '2024-01-04T01:02:03.000Z',
      mode: '644',
      uid: 1000,
      gid: 1000,
    });
  });

  it('formats a directory', () => {
    const stats = makeMockStats({ isFile: false, isDirectory: true, isSymbolicLink: false, mode: 0o755 });
    const result = formatStats('dir\\', '/abs/dir', stats as any);
    expect(result.isDirectory).toBe(true);
    expect(result.isFile).toBe(false);
    expect(result.mode).toBe('755');
  });

  it('formats a symbolic link', () => {
    const stats = makeMockStats({ isFile: false, isDirectory: false, isSymbolicLink: true, mode: 0o777 });
    const result = formatStats('link', '/abs/link', stats as any);
    expect(result.isSymbolicLink).toBe(true);
    expect(result.mode).toBe('777');
  });

  it('pads mode with leading zeros', () => {
    const stats = makeMockStats({ mode: 0o7 });
    const result = formatStats('file', '/abs/file', stats as any);
    expect(result.mode).toBe('007');
  });

  it('converts all date fields to ISO string', () => {
    const stats = makeMockStats({
      atime: new Date('2020-01-01T00:00:00.000Z'),
      mtime: new Date('2020-01-02T00:00:00.000Z'),
      ctime: new Date('2020-01-03T00:00:00.000Z'),
      birthtime: new Date('2020-01-04T00:00:00.000Z'),
    });
    const result = formatStats('file', '/abs/file', stats as any);
    expect(result.atime).toBe('2020-01-01T00:00:00.000Z');
    expect(result.mtime).toBe('2020-01-02T00:00:00.000Z');
    expect(result.ctime).toBe('2020-01-03T00:00:00.000Z');
    expect(result.birthtime).toBe('2020-01-04T00:00:00.000Z');
  });

  it('replaces backslashes in path with forward slashes', () => {
    const stats = makeMockStats();
    const result = formatStats('foo\\bar\\baz.txt', '/abs/foo/bar/baz.txt', stats as any);
    expect(result.path).toBe('foo/bar/baz.txt');
  });
});