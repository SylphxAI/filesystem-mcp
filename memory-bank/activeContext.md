<!-- Version: 1.5 | Last Updated: 2025-05-04 | Updated By: Cline -->
# Active Context: Filesystem MCP Server (v0.5.2 - Parallel CI/CD & Enhancements)

## 1. Current Work Focus

The focus is on optimizing the CI/CD pipeline for faster parallel publishing and incorporating previous enhancements to error reporting and tool descriptions.

## 2. Recent Changes/Decisions

- **README Refinement & Correction:** Iteratively updated `README.md` (details omitted).
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
- **Enhanced Path Error Reporting (`pathUtils.ts`):** Modified `src/utils/pathUtils.ts` to include more context in path-related error messages and added console logging.
- **Created `.clinerules`:** Created `memory-bank/.clinerules` to document the user preference for prioritizing edit tools over `write_to_file`.
- **Enhanced `readContent` Error Reporting:** Modified `src/handlers/readContent.ts` to include more context in `ENOENT` error messages.
- **Updated `writeContent` Description:** Modified the description for the `write_content` tool to recommend using edit tools.
- **Updated `editFile` Description:** Modified the description for the `edit_file` tool to reinforce its recommendation for modifications.
- **Parallelized CI/CD:** Refactored `.github/workflows/publish.yml` to split npm and Docker publishing into separate, parallel jobs (`publish-npm`, `publish-docker`). Introduced a shared `build` job that both publish jobs depend on, using artifacts to pass build outputs. This should speed up the overall publishing process.

## 3. Next Steps / Considerations

- **Rebuild & Restart Server:** Need to rebuild (`npm run build`) and restart the server locally if testing changes other than CI/CD.
- **Test Error Reporting & Descriptions:** Verify enhanced error messages and updated tool descriptions locally.
- **Test New Project Root Logic:** Thoroughly test behavior with different `cwd` settings locally.
- **Verify Launcher Integration:** Confirm the launching system sets `cwd` correctly.
- **Update `progress.md`:** Reflect the CI/CD parallelization.
- **Update `systemPatterns.md`:** Reflect the CI/CD parallelization.
- **Versioning:** Increment `package.json` to `0.5.2` and potentially tag the release.
- **CI/CD:** Monitor the next push to `main` to ensure the parallel jobs run correctly.
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
- **Tool Descriptions:** Updated `writeContent` and `editFile` descriptions.
- **CI/CD Structure:** Changed to parallel jobs for npm and Docker publishing, dependent on a shared build job.
