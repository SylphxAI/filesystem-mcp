<!-- Version: 2.0 | Last Updated: 2025-05-04 | Updated By: Cline -->
# System Patterns: Filesystem MCP Server

## 1. Architecture Overview

The Filesystem MCP server is a standalone Node.js application designed to run as
a child process, communicating with its parent (the AI agent host) via standard
input/output (stdio) using the Model Context Protocol (MCP).

```mermaid
graph LR
    A[Agent Host Environment] -- MCP over Stdio --> B(Filesystem MCP Server);
    B -- Node.js fs/path/glob --> C[User Filesystem (Project Root)];
    C -- Results/Data --> B;
    B -- MCP over Stdio --> A;
```

## 2. Key Technical Decisions & Patterns

- **MCP SDK Usage:** Leverages the `@modelcontextprotocol/sdk` for handling MCP
  communication (request parsing, response formatting, error handling). This
  standardizes interaction and reduces boilerplate code.
- **Stdio Transport:** Uses `StdioServerTransport` from the SDK for
  communication, suitable for running as a managed child process.
- **Asynchronous Operations:** All filesystem interactions and request handling
  are implemented using `async/await` and Node.js's promise-based `fs` module
  (`fs.promises`) for non-blocking I/O.
- **Strict Path Resolution:** A dedicated `resolvePath` function is used for
  _every_ path received from the agent.
  - It normalizes the path.
  - It resolves the path relative to the server process's current working
    directory (`process.cwd()`), which is treated as the `PROJECT_ROOT`.
    **Crucially, this requires the process launching the server (e.g., the agent
    host) to set the correct `cwd` for the target project.**
  - It explicitly checks if the resolved absolute path still starts with the
    `PROJECT_ROOT` absolute path to prevent path traversal vulnerabilities
    (e.g., `../../sensitive-file`).
  - It rejects absolute paths provided by the agent.
  - **Enhanced Error Reporting:** Throws `McpError` with detailed messages on
    failure, including the original path, resolved path (if applicable), and
    project root to aid debugging. Includes console logging for diagnostics.
- **Zod for Schemas & Validation:** Uses `zod` library to define input schemas
  for tools and perform robust validation within each handler. JSON schemas for
  MCP listing are generated from Zod schemas.
- **Tool Definition Aggregation:** Tool definitions (name, description, Zod
  schema, handler function) are defined in their respective handler files and
  aggregated in `src/handlers/index.ts` for registration in `src/index.ts`.
  - **Description Updates:** Descriptions (e.g., for `write_content`, `edit_file`) are updated based on user feedback and best practices.
- **`edit_file` Logic:**
  - Processes multiple changes per file, applying them sequentially from
    bottom-to-top to minimize line number conflicts.
  - Handles insertion, text replacement, and deletion.
  - Implements basic indentation detection (`detect-indent`) and preservation
    for insertions/replacements.
  - Uses `diff` library to generate unified diff output.
- **Error Handling:**
  - Uses `try...catch` blocks within each tool handler.
  - Catches specific Node.js filesystem errors (like `ENOENT`, `EPERM`,
    `EACCES`) and maps them to appropriate MCP error codes (`InvalidRequest`) or returns detailed error messages in the result object.
  - **Enhanced `ENOENT` Reporting:** Specifically in `readContent.ts`, `ENOENT` errors now include the resolved path, relative path, and project root in the returned error message for better context.
  - Uses custom `McpError` objects for standardized error reporting back to the
    agent (including enhanced details from `resolvePath`).
  - Logs unexpected errors to the server's console (`stderr`) for debugging.
- **Glob for Listing/Searching:** Uses the `glob` library for flexible and
  powerful file listing and searching based on glob patterns, including
  recursive operations and stat retrieval. Careful handling of `glob`'s
  different output types based on options (`string[]`, `Path[]`, `Path[]` with
  `stats`) is implemented.
- **TypeScript:** Provides static typing for better code maintainability, early
  error detection, and improved developer experience. Uses ES module syntax
  (`import`/`export`).
- **CI/CD (GitHub Actions - Separated Workflows):**
  - **CI Workflow (`ci.yml`):**
    - **Triggers:** Runs on pushes and pull requests to the `main` branch.
    - **Purpose:** Performs basic Continuous Integration checks.
    - **Jobs:** Contains a `build-check` job that checks out code, installs dependencies, and runs `npm run build` to ensure the project builds successfully on the main development line. Does *not* publish or create releases.
  - **Release Workflow (`publish.yml`):**
    - **Triggers:** Runs *only* on pushes of tags matching `v*.*.*`.
    - **Purpose:** Handles the complete release process (build, publish, create GitHub Release).
    - **Multi-Job Structure & Artifact Handling:**
      - A `build` job checks out code, installs dependencies, runs the build, archives necessary files (including `build/`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md`, `Dockerfile`, `.dockerignore`) into `build-artifacts.tar.gz`, uploads this archive as an artifact, and outputs the package version.
      - A `publish-npm` job depends on `build`, downloads and extracts the artifact, and publishes to npm.
      - A `publish-docker` job depends on `build`, downloads and extracts the artifact (using the correct path `build-artifacts.tar.gz`), sets up Docker Buildx, logs in to Docker Hub, extracts metadata, and builds/pushes the Docker image (tagging appropriately including `latest`).
      - A `create-release` job depends on `publish-npm` and `publish-docker`, downloads the artifact archive, and uses `softprops/action-gh-release` to create a GitHub Release associated with the pushed tag. It links to `CHANGELOG.md` for release notes.
    - This structure ensures releases only happen on explicit tag pushes, allows parallel publishing, and automates GitHub Release creation.

## 3. Component Relationships

- **`index.ts`:** Main entry point. Sets up the MCP server instance, defines
  tool schemas, registers request handlers, and starts the server connection.
- **`Server` (from SDK):** Core MCP server class handling protocol logic.
- **`StdioServerTransport` (from SDK):** Handles reading/writing MCP messages
  via stdio.
- **Tool Handler Functions (`handleListFiles`, `handleEditFile`, etc.):**
  Contain the specific logic for each tool, including Zod argument validation,
  path resolution, filesystem interaction, and result formatting (including enhanced error details).
- **`resolvePath` Helper:** Centralized security function for path validation with enhanced error reporting.
- **`formatStats` Helper:** Utility to create a consistent stats object
  structure.
- **Node.js Modules (`fs`, `path`):** Used for actual filesystem operations and
  path manipulation.
- **`glob` Library:** Used for pattern-based file searching and listing.
- **`zod` Library:** Used for defining and validating tool input schemas.
- **`diff` Library:** Used by `edit_file` to generate diff output.
- **`detect-indent` Library:** Used by `edit_file` for indentation handling.
- **`.github/workflows/ci.yml`:** Defines the Continuous Integration build check process.
- **`.github/workflows/publish.yml`:** Defines the automated release process (build, parallel publish, release creation) triggered by version tags.
