<!-- Version: 3.1 | Last Updated: 2025-06-04 | Updated By: Cline -->
# Active Context: Filesystem MCP Server (v0.5.8 Release)

## 1. Current Work Focus

Preparing to commit changes and tag version `0.5.8` after fixing the `.dockerignore` file, adding support link to README, and creating FUNDING.yml.

## 2. Recent Changes/Decisions

- **README Refinement & Correction:** Iteratively updated `README.md` (details omitted).
- **Dockerization:** Created `.dockerignore` and `Dockerfile`, debugged build issues. Modified `Dockerfile` to copy pre-built code and install only production dependencies.
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
- **Fixed CI/CD Artifacts:** Corrected artifact creation and extraction in `.github/workflows/publish.yml`.
- **Simplified CI/CD (Final):** Refactored back to a single workflow (`publish.yml`) with conditional artifact upload and job execution based on trigger (main push vs tag push). Deleted `ci.yml` and `build-reusable.yml`.
- **Incremented Version to 0.5.6:** Updated `package.json` to version `0.5.6` due to v0.5.5 being previously published to npm.
- **Updated Changelog for v0.5.6:** Added entry for v0.5.6 in `CHANGELOG.md`.
- **Added CI/CD Diagnostics:** Added `ls -la` steps in the `publish-docker` job in `.github/workflows/publish.yml` to help diagnose artifact download and extraction issues.
- **Added `LICENSE` File:** Created `LICENSE` file with MIT license text.
- **Updated `README.md`:** Added Glama.ai badge.
- **Fixed CI Artifact Archiving:** Corrected `tar` command in `.github/workflows/publish.yml` to include the `build` directory itself, not just its contents (5f5c7c4).
- **Incremented Version to 0.5.7:** Updated `package.json` and `CHANGELOG.md` (Release failed due to `.dockerignore`).
- **Fixed `.dockerignore`:** Removed `build` directory exclusion to allow it in Docker build context.
- **Incremented Version to 0.5.8:** Updated `package.json` and `CHANGELOG.md`.
- **Updated `README.md`:** Added 'Support the Project' section with Buy Me a Coffee link.
- **Created `.github/FUNDING.yml`:** Added funding file with Buy Me a Coffee link.

## 3. Next Steps / Considerations

- **Update `progress.md`:** Reflect the `.dockerignore` fix, README update, FUNDING.yml creation, and version bump to `0.5.8`.
- **Commit Changes:** Commit updated `README.md`, `.github/FUNDING.yml`, `.dockerignore`, `package.json`, `CHANGELOG.md`, and Memory Bank files.
- **Tag Release:** Create git tag `v0.5.8`.
- **Push Commit & Tag:** Push the commit and the new tag to `origin`.
- **Monitor CI/CD:** Verify the `v0.5.8` release workflow completes successfully.
- **Implement `edit_file` Regex Support:** (Post-release task) Add logic for `use_regex: true`.

## 4. Active Decisions

- `npx` is the primary recommended usage method.
- Docker support is implemented and automated.
- `README.md` structure and content are finalized, including support section.
- Project Root Source: Uses `process.cwd()`.
- `edit_file` Implemented (Basic).
- Batch Error Handling: Confirmed "continue on error".
- **Path Error Messages:** Enhanced with more context.
- **Tool Preference:** Documented preference for edit tools in `.clinerules`.
- **Tool Descriptions:** Updated `writeContent` and `editFile` descriptions.
- **CI/CD Structure:** Simplified single workflow (`publish.yml`) handling CI checks and tag-triggered releases. Artifact handling fixed. Diagnostic steps added.
- **Dockerfile:** Refactored to copy pre-built code and install production dependencies only.
- **Release Version:** Set to `0.5.8`.
- **Changelog:** Updated for `v0.5.8`.
- **License:** Added MIT `LICENSE` file.
- **README Badge:** Added Glama.ai badge.
- **Funding File:** Added `.github/FUNDING.yml`.
