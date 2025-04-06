<!-- Version: 4.5 | Last Updated: 2025-04-06 | Updated By: Roo -->
# Active Context: Filesystem MCP Server (Context Limit Transition)

## 1. Current Work Focus & Status

**Task:** Implement Regex support for the `edit_file` tool.
**Status:** Partially complete. Logic for handling `use_regex: true` added to `src/handlers/editFile.ts`. Corresponding tests added to `__tests__/handlers/editFile.test.ts`.
**Problem:** Three tests remain failing:
    - `should handle insertion at the beginning` (Expected 'success', got 'skipped')
    - `should successfully replace content using regex` (Expected 'success', got 'skipped', log says pattern not found)
    - `should successfully delete content using regex` (Expected 'success', got 'skipped', log says pattern not found)
**Debugging Attempts:** Multiple attempts made to fix the state management logic (`currentContent`, `lines`) within the change processing loop (lines 303-317 in `editFile.ts` are the latest attempt). The root cause remains elusive.
**Decision:** Due to context limits and debugging difficulty, pausing direct work on `edit_file` tests.

## 2. Recent Changes/Decisions

- ...(Previous entries omitted)...
- **Implemented `edit_file` Regex Support (Initial):** Added logic and tests.
- **Debugging `edit_file`:** Multiple attempts made, state management suspected.
- **Context Limit Transition:** Initiating transition due to context size (~190k chars).

## 3. Next Steps (Post-Transition)

1.  **Read ALL Memory Bank files.**
2.  **Verify Git Status:** Ensure previous commit (`feat: Add initial regex support to edit_file (tests failing)`) is clean.
3.  **Choose Path:**
    *   **Option A (Recommended first):** Add comprehensive tests (edge cases, permissions, etc.) for *other*, stable handlers (e.g., `replace_content`, `listFiles`, etc.).
    *   **Option B:** Resume deep debugging of the failing `edit_file` tests (insertion, regex replace/delete).

## 4. Active Decisions

- **Testing Framework:** Vitest.
- **Testing Strategy:** Primarily integration testing with temporary filesystem and mocked `resolvePath`.
- **Skipped Tests:** `chmodItems`, `chownItems`.
- **`deleteItems` Root Deletion Test:** Using workaround.
- **`edit_file` Regex Status:** Initial implementation committed, **3 tests failing (insertion, regex replace/delete)**. Debugging deferred.
- (Previous decisions remain active unless superseded).
