import { describe, it, expect } from 'vitest';
import {
  applyDiffInputSchema,
  applyDiffOutputSchema,
  diffResultSchema,
} from '../../src/schemas/apply-diff-schema.js';

describe('apply-diff schema', () => {
  describe('applyDiffInputSchema', () => {
    const baseDiff = {
      search: 'old',
      replace: 'new',
      start_line: 2,
      end_line: 4,
    };

    it('accepts a well-formed change set; an omitted operation stays undefined', () => {
      const parsed = applyDiffInputSchema.parse({
        changes: [{ path: 'src/a.ts', diffs: [baseDiff] }],
      });

      expect(parsed.changes).toHaveLength(1);
      expect(parsed.changes[0].path).toBe('src/a.ts');
      // operation is `.default('replace').optional()`; because .optional()
      // wraps the default, an omitted value resolves to undefined (the refine
      // then takes its non-insert branch). Downstream code treats a missing
      // operation as a replace.
      expect(parsed.changes[0].diffs[0].operation).toBeUndefined();
    });

    it('keeps an explicit "insert" operation', () => {
      const parsed = applyDiffInputSchema.parse({
        changes: [{ path: 'a.ts', diffs: [{ ...baseDiff, operation: 'insert' }] }],
      });
      expect(parsed.changes[0].diffs[0].operation).toBe('insert');
    });

    it('rejects an empty changes array (min 1)', () => {
      expect(() => applyDiffInputSchema.parse({ changes: [] })).toThrow();
    });

    it('rejects a file with an empty diffs array (min 1)', () => {
      expect(() =>
        applyDiffInputSchema.parse({ changes: [{ path: 'a.ts', diffs: [] }] }),
      ).toThrow();
    });

    it('rejects an empty file path (min 1)', () => {
      expect(() =>
        applyDiffInputSchema.parse({ changes: [{ path: '', diffs: [baseDiff] }] }),
      ).toThrow();
    });

    it('rejects start_line below 1', () => {
      expect(() =>
        applyDiffInputSchema.parse({
          changes: [{ path: 'a.ts', diffs: [{ ...baseDiff, start_line: 0 }] }],
        }),
      ).toThrow();
    });

    it('rejects non-integer line numbers', () => {
      expect(() =>
        applyDiffInputSchema.parse({
          changes: [{ path: 'a.ts', diffs: [{ ...baseDiff, start_line: 1.5 }] }],
        }),
      ).toThrow();
    });

    describe('line-number refinement', () => {
      it('rejects a replace block where end_line < start_line', () => {
        expect(() =>
          applyDiffInputSchema.parse({
            changes: [
              {
                path: 'a.ts',
                diffs: [{ ...baseDiff, operation: 'replace', start_line: 5, end_line: 4 }],
              },
            ],
          }),
        ).toThrow(/Invalid line numbers for operation type/);
      });

      it('accepts a replace block where end_line === start_line', () => {
        const parsed = applyDiffInputSchema.parse({
          changes: [
            {
              path: 'a.ts',
              diffs: [{ ...baseDiff, operation: 'replace', start_line: 5, end_line: 5 }],
            },
          ],
        });
        expect(parsed.changes[0].diffs[0].end_line).toBe(5);
      });

      it('allows an insert block where end_line === start_line - 1 (zero-width insert)', () => {
        const parsed = applyDiffInputSchema.parse({
          changes: [
            {
              path: 'a.ts',
              diffs: [{ ...baseDiff, operation: 'insert', start_line: 5, end_line: 4 }],
            },
          ],
        });
        expect(parsed.changes[0].diffs[0].operation).toBe('insert');
      });

      it('rejects an insert block where end_line < start_line - 1', () => {
        expect(() =>
          applyDiffInputSchema.parse({
            changes: [
              {
                path: 'a.ts',
                diffs: [{ ...baseDiff, operation: 'insert', start_line: 5, end_line: 2 }],
              },
            ],
          }),
        ).toThrow(/Invalid line numbers for operation type/);
      });
    });

    describe('duplicate-path refinement', () => {
      it('accepts distinct paths', () => {
        const parsed = applyDiffInputSchema.parse({
          changes: [
            { path: 'a.ts', diffs: [baseDiff] },
            { path: 'b.ts', diffs: [baseDiff] },
          ],
        });
        expect(parsed.changes).toHaveLength(2);
      });

      it('rejects a repeated file path in one request', () => {
        expect(() =>
          applyDiffInputSchema.parse({
            changes: [
              { path: 'dup.ts', diffs: [baseDiff] },
              { path: 'dup.ts', diffs: [baseDiff] },
            ],
          }),
        ).toThrow(/Each file path must appear only once/);
      });
    });
  });

  describe('diffResultSchema', () => {
    it('parses a successful result and treats error/context as optional', () => {
      const parsed = diffResultSchema.parse({
        operation: 'insert',
        start_line: 1,
        end_line: 1,
        success: true,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.error).toBeUndefined();
    });

    it('rejects an unknown operation', () => {
      expect(() =>
        diffResultSchema.parse({
          operation: 'delete',
          start_line: 1,
          end_line: 1,
          success: false,
        }),
      ).toThrow();
    });
  });

  describe('applyDiffOutputSchema', () => {
    it('parses an aggregate output payload', () => {
      const parsed = applyDiffOutputSchema.parse({
        success: false,
        results: [
          { path: 'a.ts', success: true },
          { path: 'b.ts', success: false, error: 'boom', context: 'near line 3' },
        ],
      });
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[1].error).toBe('boom');
    });
  });
});
