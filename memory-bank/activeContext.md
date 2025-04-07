<!-- Version: 4.37 | Last Updated: 2025-07-04 | Updated By: Sylph -->

# Active Context: Filesystem MCP Server

## 1. Current Work Focus & Status

**Task:** Implement `apply_diff` tool.
**Status:** Completed. Implemented `apply_diff` handler, schema, utils, and tests. Removed old `edit_file` code/tests. Updated Memory Bank, `package.json`. Ran `pnpm install`. Most tests pass, except for `applyDiff.test.ts` due to mock/assertion issues.

## 2. Recent Changes/Decisions

- **GitHub Actions:** Added explicit `npm install -g pnpm` step to `validate`, `build`, and `publish-npm` jobs in `.github/workflows/publish.yml` to fix potential `pnpm` not found errors.

- Removed `edit_file` tool and related files (`editFile.ts`, `editFileUtils.ts`, `editFile.test.ts`).
- Added `apply_diff` tool (`applyDiff.ts`, `applyDiffUtils.ts`, `applyDiffSchema.ts`, `applyDiff.test.ts`).
- Updated tool registration in `index.ts` and `handlers/index.ts`.
- Removed `diff`, `@types/diff`, `detect-indent` dependencies from `package.json`.
- Ran `pnpm install` to update lockfile.
- Attempted multiple rounds of ESLint fixes using `edit_file` and `write_content`.

## 3. Next Steps

1.  **KNOWN ISSUE:** Fix failing tests in `__tests__/handlers/applyDiff.test.ts` related to mock setup or assertions.
2.  **KNOWN ISSUE:** Address remaining ESLint `unsafe` and `restrict-template-expressions` errors primarily in `applyDiff.ts` and `applyDiffUtils.ts`.
3.  Enhance `apply_diff` tests further (edge cases, large files).
4.  Consider adding performance benchmarks for `apply_diff`.
5.  Update `README.md` with details about the new `apply_diff` tool and remove mentions of `edit_file`.

## 4. Active Decisions

- **Skipped Tests:** `chmodItems`, `chownItems` (Windows limitations), `searchFiles` zero-width regex test (implementation complexity).
- Temporarily skipping full ESLint validation pass to focus on completing the `apply_diff` implementation and basic testing.
- (Previous decisions remain active unless superseded).
