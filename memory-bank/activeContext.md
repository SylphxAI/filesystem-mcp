<!-- Version: 2.1 | Last Updated: 2025-05-04 | Updated By: Cline -->
# Active Context: Filesystem MCP Server (v0.5.5 Release)

## 1. Current Work Focus

Finalizing and preparing to trigger the v0.5.5 release after fixing CI/CD artifact issues.

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
- **Parallelized CI/CD:** Refactored `.github/workflows/publish.yml` to split npm and Docker publishing into separate, parallel jobs.
- **Incremented Version to 0.5.3:** Updated `package.json` to version `0.5.3`.
- **Created Changelog:** Generated and created `CHANGELOG.md` file documenting changes since v0.5.1 for the v0.5.3 release.
- **Automated GitHub Releases:** Modified `.github/workflows/publish.yml` to add automatic GitHub Release creation on tag pushes.
- **Fixed Docker CI/CD Artifact Extraction:** Corrected the `tar` command in the `publish-docker` job.
- **Refined CI/CD Triggers:** Modified `.github/workflows/publish.yml` so that publishing jobs only run on version tag pushes.
- **Incremented Version to 0.5.5:** Updated `package.json` to version `0.5.5`.
- **Updated Changelog:** Added entry for v0.5.5 in `CHANGELOG.md`.
- **Fixed CI/CD Artifacts:**
    - Modified `build` job in `.github/workflows/publish.yml` to include `package-lock.json` in the `build-artifacts.tar.gz`.
    - Corrected the `tar` command in the `publish-npm` job to extract the artifact archive from the correct path.

## 3. Next Steps / Considerations

- **Update `progress.md`:** Reflect the CI/CD artifact fixes.
- **Update `systemPatterns.md`:** Reflect the CI/CD artifact fixes.
- **Commit Changes:** Commit the updated workflow file and Memory Bank updates.
- **Push Commit:** Push the changes to `origin main`.
- **Re-run Release Process:** Delete remote/local `v0.5.5` tag, re-tag the latest commit, and push the tag again to trigger the fixed workflow.
- **Monitor CI/CD:** Verify all jobs (`build`, `publish-npm`, `publish-docker`, `create-release`) succeed for the `v0.5.5` tag push.
- **Implement `edit_file` Regex Support:** (Post-release task) Add logic for `use_regex: true`.

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
- **CI/CD Structure:** Parallel jobs with automatic GitHub Release creation. Artifact extraction fixed for Docker and npm jobs. Artifact creation includes `package-lock.json`.
- **CI/CD Triggers:** Publishing jobs now run *only* on version tag pushes.
- **Release Version:** Set to `0.5.5`.
- **Changelog:** Updated for `v0.5.5`.
