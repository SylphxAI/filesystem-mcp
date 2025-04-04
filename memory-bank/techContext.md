# Tech Context: Filesystem MCP Server

## 1. Core Technologies

- **Runtime:** Node.js (Version should be compatible with used libraries, likely
  > = 18)
- **Language:** TypeScript (Compiled to JavaScript for execution)
- **Package Manager:** npm (Node Package Manager)

## 2. Key Libraries/Dependencies

- **`@modelcontextprotocol/sdk`:** The official SDK for implementing MCP servers
  and clients. Used for:
  - `Server`: Core server class.
  - `StdioServerTransport`: Communication via standard input/output.
  - Schema definitions (`CallToolRequestSchema`, `ListToolsRequestSchema`).
  - Error types (`McpError`, `ErrorCode`).
- **`glob`:** Library for matching files using glob patterns (like `*`, `**/*`,
  `*.ts`). Used extensively in `list_files` and search tools.
- **`typescript`:** TypeScript compiler (`tsc`).
- **`@types/node`:** TypeScript type definitions for Node.js built-in modules
  (`fs`, `path`, `process`, etc.).
- **`@types/glob`:** TypeScript type definitions for the `glob` library.

## 3. Development Setup

- **Source Code:** Located in the `src` directory (`filesystem-mcp/src`).
- **Main File:** `src/index.ts`.
- **Configuration:**
  - `tsconfig.json`: Configures the TypeScript compiler options (target ES
    version, module system, output directory, etc.). Set to output JavaScript
    files to the `build` directory.
  - `package.json`: Defines project metadata, dependencies, and npm scripts.
    - `dependencies`: `@modelcontextprotocol/sdk`, `glob`.
    - `devDependencies`: `typescript`, `@types/node`, `@types/glob`.
    - `scripts`:
      - `build`: Compiles TypeScript code using `tsc` and potentially sets
        execute permissions on the output script.
      - `start`: (Optional, for direct testing) Runs the compiled JavaScript
        server using `node build/index.js`.
- **Build Output:** Compiled JavaScript code is placed in the `build` directory
  (`filesystem-mcp/build`).
- **Execution:** The server is intended to be run via `node build/index.js`.

## 4. Technical Constraints & Considerations

- **Node.js Environment:** The server relies on the Node.js runtime and its
  built-in modules, particularly `fs` (filesystem) and `path`.
- **Permissions:** The server process runs with the permissions of the user who
  started it. Filesystem operations might fail due to insufficient permissions
  on the target files/directories. `chmod` might have limited effect or fail on
  non-POSIX systems like Windows.
- **Cross-Platform Compatibility:** While Node.js aims for cross-platform
  compatibility, filesystem behaviors (path separators, case sensitivity,
  `chmod` behavior) can differ slightly between Windows, macOS, and Linux. Code
  uses `path.join`, `path.resolve`, `path.normalize`, and replaces backslashes
  (`\`) with forward slashes (`/`) in output paths to mitigate some issues.
- **Error Handling:** Relies on Node.js error codes (`ENOENT`, `EPERM`, etc.)
  for specific filesystem error detection.
- **Security Model:** Security relies entirely on the `resolvePath` function
  correctly preventing access outside the `PROJECT_ROOT`. No other sandboxing
  mechanism is implemented.
- **Project Root Determination:** The effective `PROJECT_ROOT` for path
  resolution is the server process's current working directory
  (`process.cwd()`). This means the system launching the server (e.g., the agent
  host environment) **must** set the correct working directory corresponding to
  the target project at launch time to ensure the server operates on the
  intended files.
