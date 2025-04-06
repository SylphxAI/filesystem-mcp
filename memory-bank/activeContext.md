<!-- Version: 4.8 | Last Updated: 2025-04-06 | Updated By: Roo -->
# Active Context: Filesystem MCP Server (Context Limit Transition 2)

## 1. Current Work Focus & Status

**Task:** Fix failing `editFile.ts` tests (Regex replace/delete).
**Status:** Debugging blocked. Attempted to revert CRLF handling logic in Regex creation and remove debug logs using `apply_diff`, but the tool failed *again* due to file content changes between `read_file` and `apply_diff` operations. The file state is highly unstable, and `apply_diff` is unusable on this file. Coverage report generation is also still failing. Context limit (~347k) reached again.
**Problem:** Two tests remain failing:
    - `should successfully replace content using regex` (Expected 'success', got 'skipped')
    - `should successfully delete content using regex` (Expected 'success', got 'skipped')
**Debugging Attempts:** Previous attempts involved modifying Regex logic and adding/removing logs, all hampered by `apply_diff` failures. Last successful file read was at 1:09:34 PM.

## 2. Recent Changes/Decisions

- ...(Previous entries omitted)...
- Attempted to revert CRLF handling logic via `apply_diff`, failed again.
- **Context Limit Transition 2:** Initiating transition due to context size (~347k chars) and persistent tool failures.

## 3. Next Steps (Post-Transition)

1.  **Read ALL Memory Bank files.**
2.  **Verify Git Status:** Ensure working directory is clean.
3.  **Read `src/handlers/editFile.ts`:** Get the definitive current state.
4.  **Manually Revert & Clean:** Use `write_to_file` with the *entire corrected file content*, ensuring the Regex creation logic is reverted to `regex = new RegExp(search_pattern, 'g');` and *all* previous debug logs are removed. Verify the `for` loop logic for Nth occurrence is correct.
5.  **Run tests (`npm test`)**.
6.  **Analyze results:** If tests still fail, the issue with `regex.exec` loop execution persists and needs further investigation, possibly by simplifying the test case or handler logic temporarily. If tests pass, proceed to investigate coverage report issue.

## 4. Active Decisions

- **Testing Framework:** Vitest.
- **Testing Strategy:** Primarily integration testing.
- **Skipped Tests:** `chmodItems`, `chownItems`.
- **`edit_file` Regex Status:** Logic seems flawed; `regex.exec` loop doesn't execute. **2 tests failing (regex replace/delete)**. Debugging blocked by tool failures and context limit.
- **`apply_diff` Unreliability:** Avoid using `apply_diff` on `src/handlers/editFile.ts` until file stability is confirmed. Prefer `write_to_file` for now.
- (Previous decisions remain active unless superseded).
