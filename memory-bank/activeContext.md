# Active Context: Filesystem MCP Server (v0.5.0 - Dynamic Project Root via CWD)

## 1. Current Work Focus

The focus shifted from the project root logic (which was updated) to
implementing a new advanced editing tool (`edit_file`).

## 2. Recent Changes/Decisions

- **README Refinement & Correction:** Iteratively updated `README.md` based on
  feedback:
  - Added npm and Docker Hub badges.
  - Restructured to prioritize `npx` usage as the recommended quick start.
  - Added instructions and example for using `bunx` as an alternative to `npx`.
  - Added a dedicated section highlighting key features/selling points (security
    via relative paths, efficiency via batch operations).
  - Included detailed instructions for Docker usage, emphasizing volume
    mounting.
  - Added/removed/re-added/ **finally removed** comments in JSON examples to
    ensure **standard JSON compliance** after clarification.
  - Included sections on development and contributing.
- **Dockerization:**
  - Created `.dockerignore` and `Dockerfile` (multi-stage build).
  - Iteratively debugged `Dockerfile` build issues related to `.dockerignore`
    exclusions and `npm ci` script execution order, resolving them by using
    `npm ci --ignore-scripts` and running `npm run build` after copying all
    source.
- **CI/CD Setup (GitHub Actions):**
  - Modified `.github/workflows/publish.yml` to automate publishing to both npm
    and Docker Hub on pushes to `main`.
- **Versioning:** Incremented the package version multiple times (up to
  `0.4.11`) in `package.json` to trigger CI/CD runs for README updates, Docker
  fixes, and the final JSON comment correction.
- **Project Root Determination Changed:** Modified `src/utils/pathUtils.ts` to
  use the server process's current working directory (`process.cwd()`) as the
  `PROJECT_ROOT`. This allows the server to operate relative to the agent's
  current project, **but requires the launching process to set the `cwd`
  correctly.**
- **Memory Bank Updated:** Updated `systemPatterns.md`, `productContext.md`, and
  `techContext.md`, `progress.md` to reflect the new `process.cwd()`-based
  project root logic and its implications.
- **Added `edit_file` Tool (Basic):**
  - Implemented a new handler `src/handlers/editFile.ts`.
  - Defined Zod schema for complex edit operations (insert, text
    replace/delete).
  - Added logic for handling multiple changes per file, bottom-up processing,
    basic indentation preservation, and diff generation using `diff` and
    `detect-indent` libraries.
  - Integrated the tool definition into `src/handlers/index.ts`.
- **Troubleshooting Build Error:** Investigated persistent `tsc` error "Cannot
  find module '@modelcontextprotocol/sdk'" by performing clean installs,
  checking `tsconfig.json`, adjusting import paths, and modifying
  `skipLibCheck`, without success. Removed `prepare` script from `package.json`
  as a temporary workaround to allow `npm install` to complete.
- **Memory Bank Updated:** Updated `projectbrief.md`, `systemPatterns.md`,
  `techContext.md`, and `progress.md` to include the new `edit_file` tool and
  related dependencies/patterns.

## 3. Next Steps / Considerations

- **Test New Project Root Logic:** Thoroughly test the server's behavior when
  launched with different `cwd` settings to ensure it correctly targets
  different project roots.
- **Verify Launcher Integration:** Confirm that the system launching the MCP
  server (e.g., Cline extension) correctly sets the `cwd` for each project
  context.
- **Update `progress.md`:** Reflect the change in project root logic and the
  current testing status.
- **Update `README.md`:** Add documentation explaining the new requirement for
  the launcher to set the `cwd`.
- **Consider Versioning:** Decide if this change warrants a major/minor version
  bump (likely yes, e.g., `0.5.0`). Update `package.json`.
- **CI/CD:** Ensure CI/CD pipeline still functions correctly after the changes.
- **Resolve `list_files` Issue (Glob Path):** (Previous issue, lower priority
  now) Investigate the `glob`-based execution path within `handleListFiles`.
- **Implement `edit_file` Regex Support:** Add logic for handling
  `use_regex: true`.
- **Resolve Build Error:** Find the root cause of the persistent `tsc` error
  preventing the SDK module from being found.

## 4. Active Decisions

- `npx` is the primary recommended usage method in the documentation.
- Docker support is implemented and automated via GitHub Actions.
- The `Dockerfile` build process is corrected.
- The `README.md` structure and content are finalized, including `bunx`
  instructions, with JSON examples adhering to standard JSON (no comments).
- **Project Root Source:** The server now uses `process.cwd()` as the project
  root, requiring the launcher to set it appropriately.
- **`edit_file` Implemented (Basic):** The core structure and basic
  text/insertion logic for the new tool are in place.
