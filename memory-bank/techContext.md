<!-- Version: 4.3 | Last Updated: 2025-04-06 | Updated By: Roo -->
# Tech Context: Filesystem MCP Server

## 1. Core Technologies

- **Runtime:** Node.js (Version should be compatible with used libraries, likely >= 18)
- **Language:** TypeScript (Compiled to JavaScript for execution)
- **Package Manager:** npm (Node Package Manager)
- **Testing Framework:** Vitest (using v8 for coverage)

## 2. Key Libraries/Dependencies

- **`@modelcontextprotocol/sdk`:** The official SDK for implementing MCP servers and clients.
- **`glob`:** Library for matching files using glob patterns.
- **`typescript`:** TypeScript compiler (`tsc`).
- **`@types/node`:** TypeScript type definitions for Node.js built-in modules.
- **`@types/glob`:** TypeScript type definitions for the `glob` library.
- **`zod`:** Library for schema declaration and validation.
- **`zod-to-json-schema`:** Utility to convert Zod schemas to JSON schemas.
- **`diff`:** Library for generating text differences (used by `edit_file`).
- **`detect-indent`:** Library for detecting indentation (used by `edit_file`).
- **`@types/diff`:** TypeScript type definitions for the `diff` library.
- **`vitest`:** Testing framework.
- **`@vitest/coverage-v8`:** Coverage provider for Vitest.
- **`uuid`:** For generating unique IDs (used in testUtils).
- **`@types/uuid`:** TypeScript type definitions for uuid.

## 3. Development Setup

- **Source Code:** Located in the `src` directory.
- **Tests:** Located in the `__tests__` directory.
- **Main File:** `src/index.ts`.
- **Configuration:**
  - `tsconfig.json`: Configures the TypeScript compiler options.
  - `vitest.config.ts`: Configures Vitest (test environment, globals, coverage).
  - `package.json`: Defines project metadata, dependencies, and npm scripts.
    - `dependencies`: `@modelcontextprotocol/sdk`, `glob`, `zod`, `zod-to-json-schema`, `diff`, `detect-indent`.
    - `devDependencies`: `typescript`, `@types/node`, `@types/glob`, `@types/diff`, `vitest`, `@vitest/coverage-v8`, `uuid`, `@types/uuid`.
    - `scripts`:
      - `build`: Compiles TypeScript code.
      - `watch`: Runs `tsc` in watch mode.
      - `inspector`: Runs the MCP inspector tool.
      - `test`: Runs Vitest tests with coverage (`vitest run --coverage`).
- **Build Output:** Compiled JavaScript code is placed in the `build` directory.
- **Execution:** The server is intended to be run via `node build/index.js`.

## 4. Technical Constraints & Considerations

- **Node.js Environment:** Relies on Node.js runtime and built-in modules.
- **Permissions:** Server process permissions limit filesystem operations.
- **Cross-Platform Compatibility:** Filesystem behaviors differ. Code uses `path` module and normalizes slashes.
- **Error Handling:** Relies on Node.js error codes and `McpError`.
- **Security Model:** Relies on `resolvePath` function.
- **Project Root Determination:** Uses `process.cwd()`. Launching process must set correct `cwd`.
- **ESM:** Project uses ES Modules. Vitest generally handles ESM well, including mocking.
