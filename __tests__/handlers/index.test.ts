import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allToolDefinitions } from '../../src/handlers/index.js';

// The handler index aggregates every tool definition plus an inline `apply_diff`
// entry. These tests assert the real aggregation and exercise the inline
// apply_diff handler end-to-end against a temp file on disk.

describe('handlers/index aggregation', () => {
  it('exposes every expected tool exactly once', () => {
    const names = allToolDefinitions.map((d) => d.name);
    const expected = [
      'list_files',
      'stat_items',
      'read_content',
      'write_content',
      'delete_items',
      'create_directories',
      'chmod_items',
      'chown_items',
      'move_items',
      'copy_items',
      'search_files',
      'replace_content',
      'apply_diff',
    ];

    for (const name of expected) {
      expect(names, `missing tool: ${name}`).toContain(name);
    }
    // No duplicate registrations.
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every definition a name, description, schema, and handler', () => {
    for (const def of allToolDefinitions) {
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.description).toBe('string');
      expect(def.inputSchema).toBeDefined();
      expect(typeof def.handler).toBe('function');
    }
  });
});

describe('inline apply_diff handler', () => {
  const applyDiff = allToolDefinitions.find((d) => d.name === 'apply_diff');
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsmcp-applydiff-'));
    // The inline handler resolves paths against process.cwd().
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('is registered', () => {
    expect(applyDiff).toBeDefined();
  });

  it('applies a replace diff to a real file and reports success', async () => {
    await fs.writeFile(path.join(tmpDir, 'greeting.txt'), 'hello\nworld\n', 'utf8');

    const response = await applyDiff!.handler({
      changes: [
        {
          path: 'greeting.txt',
          diffs: [
            {
              search: 'world',
              replace: 'there',
              start_line: 2,
              end_line: 2,
              operation: 'replace',
            },
          ],
        },
      ],
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.results[0]).toMatchObject({ path: 'greeting.txt', success: true });

    const written = await fs.readFile(path.join(tmpDir, 'greeting.txt'), 'utf8');
    expect(written).toContain('there');
    expect(written).not.toContain('world');
  });

  it('rejects input that fails schema validation', async () => {
    // Empty changes array violates the .min(1) constraint.
    await expect(applyDiff!.handler({ changes: [] })).rejects.toThrow();
  });

  it('reports failure when a referenced file does not exist', async () => {
    // The handler reads the original content first; a missing file rejects the
    // underlying readFile, which propagates out of the handler.
    await expect(
      applyDiff!.handler({
        changes: [
          {
            path: 'missing.txt',
            diffs: [
              {
                search: 'a',
                replace: 'b',
                start_line: 1,
                end_line: 1,
                operation: 'replace',
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow();
  });
});
