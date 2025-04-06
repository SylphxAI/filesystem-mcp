<!-- Version: 2.0 | Last Updated: 2025-06-06 | Updated By: Roo -->
# Tech Context: Filesystem MCP Server

## 1. Core Technologies

- **Runtime:** Node.js (Version should be compatible with used libraries, likely
  > = 18)
- **Language:** TypeScript (Compiled to JavaScript for execution)
- **Package Manager:** npm (Node Package Manager)
- **Testing Framework:** Jest (with `ts-jest` for TypeScript support)

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
- **`zod`:** Library for schema declaration and validation. Used for all tool
  inputs.
- **`zod-to-json-schema`:** Utility to convert Zod schemas to JSON schemas for
  MCP tool listing.
- **`diff`:** Library for generating text differences. Used by `edit_file`.
- **`detect-indent`:** Library for detecting the dominant indentation in code.
  Used by `edit_file`.
- **`@types/diff`:** TypeScript type definitions for the `diff` library.
- **`jest`:** Testing framework.
- **`@types/jest`:** TypeScript type definitions for Jest.
- **`ts-jest`:** Jest transformer for TypeScript, enabling tests to be written in TS and handling ESM complexities.
- **`cross-env`:** Utility to set environment variables (like `NODE_OPTIONS`) cross-platform in npm scripts.

## 3. Development Setup

- **Source Code:** Located in the `src` directory (`filesystem-mcp/src`).
- **Tests:** Located in the `__tests__` directory.
- **Main File:** `src/index.ts`.
- **Configuration:**
  - `tsconfig.json`: Configures the TypeScript compiler options for production builds.
  - `tsconfig.test.json`: Extends `tsconfig.json`, adjusts settings (`rootDir`, `noEmit`) and includes test/mock files for Jest compilation via `ts-jest`.
  - `jest.config.js`: Configures Jest, specifying `ts-jest` preset, test environment, and handling for ESM modules/dependencies.
  - `package.json`: Defines project metadata, dependencies, and npm scripts.
    - `dependencies`: `@modelcontextprotocol/sdk`, `glob`, `zod`, `zod-to-json-schema`, `diff`, `detect-indent`.
    - `devDependencies`: `typescript`, `@types/node`, `@types/glob`, `@types/diff`, `jest`, `@types/jest`, `ts-jest`, `cross-env`.
    - `scripts`:
      - `build`: Compiles TypeScript code using `tsc`.
      - `watch`: Runs `tsc` in watch mode.
      - `inspector`: Runs the MCP inspector tool.
      - `test`: Runs Jest tests using `cross-env` to set `NODE_OPTIONS=--experimental-vm-modules` for ESM support.
- **Build Output:** Compiled JavaScript code is placed in the `build` directory.
- **Execution:** The server is intended to be run via `node build/index.js`.

## 4. Technical Constraints & Considerations

- **Node.js Environment:** Relies on Node.js runtime and built-in modules.
- **Permissions:** Server process permissions limit filesystem operations.
- **Cross-Platform Compatibility:** Filesystem behaviors differ. Code uses `path` module and normalizes slashes.
- **Error Handling:** Relies on Node.js error codes and `McpError`.
- **Security Model:** Relies on `resolvePath` function.
- **Project Root Determination:** Uses `process.cwd()`. Launching process must set correct `cwd`.
- **ESM Mocking:** Mocking ES Modules (especially in `node_modules`) with Jest and `ts-jest` proved challenging. Current test setup uses a mix of `jest.unstable_mockModule` (for `editFile`) and integration testing with temporary directories (for `listFiles`). Requires `NODE_OPTIONS=--experimental-vm-modules` flag for test execution.
