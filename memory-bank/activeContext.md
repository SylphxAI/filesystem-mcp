# Active Context: Filesystem MCP Server (v0.4.10 - Docker & CI/CD)

## 1. Current Work Focus

The focus shifted to improving deployment and documentation, including adding
Docker support, setting up automated publishing via GitHub Actions, and refining
the README.

## 2. Recent Changes/Decisions

- **README Refinement:** Iteratively updated `README.md` based on feedback:
  - Added npm and Docker Hub badges.
  - Restructured to prioritize `npx` usage as the recommended quick start.
  - Added a dedicated section highlighting key features/selling points (security
    via relative paths, efficiency via batch operations).
  - Included detailed instructions for Docker usage, emphasizing volume
    mounting.
  - Added/removed/re-added comments in JSON examples based on user preference
    for readability within Markdown.
  - Included sections on development and contributing.
- **Dockerization:**
  - Created `.dockerignore` to exclude unnecessary files from the build context.
  - Created `Dockerfile` using a multi-stage build for a smaller final image:
    - Uses `node:20-alpine`.
    - Installs all dependencies (including dev) in the builder stage.
    - Copies source code.
    - Runs `npm run build`.
    - Prunes dev dependencies (`npm prune --omit=dev`).
    - Copies build artifacts and production dependencies to the final stage.
    - Sets up a non-root user (`appuser`).
    - Sets the final `CMD` to run the server.
  - Iteratively debugged `Dockerfile` build issues related to `.dockerignore`
    exclusions and `npm ci` script execution order, finally resolving them by
    using `npm ci --ignore-scripts` and running `npm run build` after copying
    all source.
- **CI/CD Setup (GitHub Actions):**
  - Modified `.github/workflows/publish.yml` to automate publishing.
  - The workflow now triggers on pushes to `main` and performs:
    1. Checkout code.
    2. Set up Node.js.
    3. Install dependencies (`npm ci`).
    4. Build project (`npm run build`).
    5. Publish to npm (using `NPM_TOKEN` secret).
    6. Set up Docker Buildx.
    7. Log in to Docker Hub (using `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`
       secrets).
    8. Extract Docker metadata (tags based on version, branch, sha).
    9. Build and push Docker image to Docker Hub (`shtse8/filesystem-mcp`).
- **Versioning:** Incremented the package version multiple times (up to
  `0.4.10`) in `package.json` to trigger CI/CD runs for README updates and
  Docker fixes.

## 3. Next Steps / Considerations

- **Verify CI/CD:** Confirm the latest GitHub Actions run (triggered by commit
  `aded372` for version `0.4.10`) successfully published to both npm and Docker
  Hub.
- **Resolve `list_files` / Server Reload Issue:** (Previous issue) The primary
  remaining _functional_ issue is diagnosing why the `glob`-based path in
  `list_files` wasn't working reliably. This might require external
  investigation or specific testing now that deployment is stable.
- **Comprehensive Testing:** Perform thorough testing, especially focusing on:
  - Edge cases for all tools.
  - `list_files` with recursion and stats enabled (once the underlying issue is
    addressed or confirmed resolved).
  - `chmod_items` and `chown_items` behavior on different OS (especially
    Windows).
  - Error handling for batch operations.
- **Update Other Memory Bank Files:** Review `progress.md`, `systemPatterns.md`,
  and `techContext.md` to ensure they reflect the addition of Docker and CI/CD.

## 4. Active Decisions

- `npx` is the primary recommended usage method in the documentation.
- Docker support is implemented and automated via GitHub Actions.
- The `Dockerfile` build process is corrected to handle dependencies and build
  steps correctly.
- The `README.md` structure and content have been finalized based on recent
  feedback.
