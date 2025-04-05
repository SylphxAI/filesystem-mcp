<!-- Version: 1.1 | Last Updated: 2025-05-04 | Updated By: Cline -->
# Active Context: Filesystem MCP Server (v0.5.2 - Enhanced Path Error Reporting)

## 1. Current Work Focus

The focus is on improving the clarity of error messages related to path resolution and documenting user preferences for tool usage.

## 2. Recent Changes/Decisions

- **README Refinement & Correction:** Iteratively updated `README.md` based on feedback (details omitted for brevity, see previous version).
- **Dockerization:** Created `.dockerignore` and `Dockerfile`, debugged build issues.
- **CI/CD Setup (GitHub Actions):** Modified workflow to publish to npm and Docker Hub.
- **Versioning:** Incremented version multiple times (up to `0.4.11`) for CI/CD triggers.
- **Project Root Determination Changed:** Modified `src/utils/pathUtils.ts` to use `process.cwd()` as `PROJECT_ROOT`.
- **Memory Bank Updated:** Updated relevant files to reflect the `process.cwd()` logic.
- **Added `edit_file` Tool (Basic):** Implemented handler, schema, and basic logic.
- **Troubleshooting Build Error:** Investigated and worked around a `tsc` error.
- **Memory Bank Updated:** Updated files to include `edit_file` details.
- **Verified Batch Error Handling:** Confirmed "continue on error" behavior for batch tools.
- **Fixed `edit_file` Return Structure:** Corrected return statement for MCP compliance.
- **Tested `edit_file`:** Successfully tested with mixed outcomes.
- **Updated `README.md`:** Added `edit_file` details.
- **Incremented Version:** Updated `package.json` to version `0.5.1`.
- **Enhanced Path Error Reporting:** Modified `src/utils/pathUtils.ts` to include the user-provided path, resolved path, and project root in error messages for absolute path and path traversal issues, improving debugging context (especially for devcontainer scenarios).
- **Created `.clinerules`:** Created `memory-bank/.clinerules` to document the user preference for prioritizing edit tools (`apply_diff`, `insert_content`, `search_and_replace`) over `write_to_file` for modifying existing files to improve performance.

## 3. Next Steps / Considerations

- **Test New Project Root Logic:** Thoroughly test the server's behavior with different `cwd` settings.
- **Verify Launcher Integration:** Confirm the launching system sets `cwd` correctly.
- **Update `progress.md`:** Reflect the enhanced error reporting and `.clinerules` creation.
- **Update `systemPatterns.md`:** Update `resolvePath` description.
- **Versioning:** Increment `package.json` to `0.5.2` and potentially tag the release.
- **CI/CD:** Ensure pipeline functions correctly.
- **Implement `edit_file` Regex Support:** Add logic for `use_regex: true`.

## 4. Active Decisions

- `npx` is the primary recommended usage method.
- Docker support is implemented and automated.
- `README.md` structure and content are finalized.
- Project Root Source: Uses `process.cwd()`.
- `edit_file` Implemented (Basic).
- Batch Error Handling: Confirmed "continue on error".
- **Path Error Messages:** Enhanced with more context.
- **Tool Preference:** Documented preference for edit tools in `.clinerules`.
