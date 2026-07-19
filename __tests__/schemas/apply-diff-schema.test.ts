import { describe, expect, it } from 'vitest'
import { applyDiffInputSchema } from '../../src/schemas/apply-diff-schema.ts'

/**
 * Characterization tests for the pure Zod validation in apply-diff-schema.
 *
 * These exercise the schema refinements through the public entry point
 * (`applyDiffInputSchema`), which nests `fileDiffSchema` and the
 * operation-aware `refinedDiffBlockSchema`. They lock down the current
 * (non-obvious) validation behavior, in particular the differing
 * line-number rules for `insert` vs `replace` and the omitted-`operation`
 * case, so future refactors stay behavior-preserving.
 */

const makeDiff = (overrides: Record<string, unknown> = {}) => ({
	search: 'old',
	replace: 'new',
	start_line: 1,
	end_line: 1,
	...overrides,
})

const makeInput = (diffOverrides: Record<string, unknown> = {}, path = 'src/file.ts') => ({
	changes: [{ path, diffs: [makeDiff(diffOverrides)] }],
})

describe('applyDiffInputSchema', () => {
	it('accepts a minimal valid request', () => {
		const result = applyDiffInputSchema.safeParse(makeInput())
		expect(result.success).toBe(true)
	})

	describe('operation handling', () => {
		it('defaults omitted operation to replace', () => {
			// Zod applies `.default('replace')` when the key is omitted.
			const result = applyDiffInputSchema.safeParse(makeInput())
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.changes[0].diffs[0].operation).toBe('replace')
			}
		})

		it('preserves an explicit replace operation', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({ operation: 'replace' }))
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.changes[0].diffs[0].operation).toBe('replace')
			}
		})

		it('preserves an explicit insert operation', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({ operation: 'insert', start_line: 2, end_line: 2 }))
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.changes[0].diffs[0].operation).toBe('insert')
			}
		})

		it('rejects an unknown operation value', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({ operation: 'delete' }))
			expect(result.success).toBe(false)
		})
	})

	describe('line-number refinement', () => {
		it('accepts end_line === start_line for replace', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({ operation: 'replace', start_line: 5, end_line: 5 }))
			expect(result.success).toBe(true)
		})

		it('accepts end_line > start_line for replace', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({ operation: 'replace', start_line: 5, end_line: 9 }))
			expect(result.success).toBe(true)
		})

		it('rejects end_line < start_line for replace', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({ operation: 'replace', start_line: 5, end_line: 4 }))
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.issues[0].message).toBe('Invalid line numbers for operation type')
			}
		})

		it('applies the replace rule when operation is omitted', () => {
			// Omitted operation is `undefined`, so the non-insert (replace) rule applies:
			// end_line must be >= start_line.
			const result = applyDiffInputSchema.safeParse(makeInput({ start_line: 5, end_line: 4 }))
			expect(result.success).toBe(false)
		})

		it('accepts end_line === start_line - 1 for insert', () => {
			// The insert rule is intentionally looser: end_line >= start_line - 1,
			// allowing an empty range that represents inserting before a line.
			const result = applyDiffInputSchema.safeParse(makeInput({ operation: 'insert', start_line: 2, end_line: 1 }))
			expect(result.success).toBe(true)
		})

		it('rejects end_line < start_line - 1 for insert', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({ operation: 'insert', start_line: 3, end_line: 1 }))
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.issues[0].message).toBe('Invalid line numbers for operation type')
			}
		})
	})

	describe('numeric constraints', () => {
		it('rejects a non-integer start_line', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({ start_line: 1.5, end_line: 2 }))
			expect(result.success).toBe(false)
		})

		it('rejects start_line below 1', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({ start_line: 0, end_line: 1 }))
			expect(result.success).toBe(false)
		})

		it('rejects end_line below 1', () => {
			// operation insert with start_line 1 keeps the refinement satisfied (0 >= 0),
			// isolating the end_line `.min(1)` constraint as the sole failure.
			const result = applyDiffInputSchema.safeParse(makeInput({ operation: 'insert', start_line: 1, end_line: 0 }))
			expect(result.success).toBe(false)
		})
	})

	describe('array and path constraints', () => {
		it('rejects an empty changes array', () => {
			const result = applyDiffInputSchema.safeParse({ changes: [] })
			expect(result.success).toBe(false)
		})

		it('rejects an empty diffs array', () => {
			const result = applyDiffInputSchema.safeParse({
				changes: [{ path: 'src/file.ts', diffs: [] }],
			})
			expect(result.success).toBe(false)
		})

		it('rejects an empty file path', () => {
			const result = applyDiffInputSchema.safeParse(makeInput({}, ''))
			expect(result.success).toBe(false)
		})

		it('rejects duplicate file paths in a single request', () => {
			const result = applyDiffInputSchema.safeParse({
				changes: [
					{ path: 'src/dup.ts', diffs: [makeDiff()] },
					{ path: 'src/dup.ts', diffs: [makeDiff()] },
				],
			})
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.issues[0].message).toBe('Each file path must appear only once in a single request.')
			}
		})

		it('accepts distinct file paths in a single request', () => {
			const result = applyDiffInputSchema.safeParse({
				changes: [
					{ path: 'src/a.ts', diffs: [makeDiff()] },
					{ path: 'src/b.ts', diffs: [makeDiff()] },
				],
			})
			expect(result.success).toBe(true)
		})
	})
})
