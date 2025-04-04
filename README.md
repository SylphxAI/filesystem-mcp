# Filesystem MCP Server

A Model Context Protocol (MCP) server designed to provide controlled access to a
user's filesystem relative to a defined project root directory.

This server allows AI agents (like Cline) to interact with project files
securely and efficiently, performing common filesystem operations without
requiring direct, unrestricted access.

## Features

Provides a comprehensive set of tools for filesystem manipulation:

- **`list_files`**: List files and directories within a specified relative path.
  - Supports recursive listing (`recursive: true`).
  - Supports including detailed file statistics (`include_stats: true`).
- **`stat_items`**: Get detailed status information (size, dates, permissions,
  etc.) for multiple specified relative paths.
- **`read_content`**: Read the UTF-8 content of multiple specified files.
- **`write_content`**: Write or append UTF-8 content to multiple specified
  files. Automatically creates necessary parent directories.
- **`delete_items`**: Delete multiple specified files or directories
  recursively.
- **`create_directories`**: Create multiple specified directories, including any
  necessary intermediate parent directories.
- **`chmod_items`**: Change the permission mode (e.g., '755', '644') for
  multiple specified files or directories (Behavior may vary on non-POSIX
  systems like Windows).
- **`chown_items`**: Change the owner (UID) and group (GID) for multiple
  specified files or directories (Primarily for POSIX systems; may have limited
  effect or require specific permissions on Windows).
- **`move_items`**: Move or rename multiple specified files or directories.
- **`copy_items`**: Copy multiple specified files or directories recursively.
- **`search_files`**: Search for a regex pattern within files in a specified
  directory (optionally filtered by a file pattern). Returns matches with line
  numbers and context.
- **`replace_content`**: Perform search-and-replace operations (text or regex)
  within multiple specified files.

## Key Characteristics

- **Security:** All paths provided to tools _must_ be relative to the project
  root. The server strictly enforces this boundary, preventing path traversal
  attacks and access outside the designated project directory.
- **Technology:** Built with Node.js and TypeScript. Uses the
  `@modelcontextprotocol/sdk` for MCP communication and `glob` for pattern
  matching.
- **Validation:** Uses Zod schemas for robust runtime validation of all incoming
  tool arguments.
- **Modularity:** Code is organized with handlers, schemas, and types colocated
  in `src/handlers/`, utilities in `src/utils/`, and main server setup in
  `src/index.ts`.

## Development

Install dependencies:

```bash
npm install
```

Build the server (compiles TypeScript to JavaScript in `build/`):

```bash
npm run build
```

The build command also sets execute permissions on the output script
(`build/index.js`).

## Installation & Usage

This server is typically run as a background process managed by an MCP host
environment (like the Roo/Cline VSCode extension). Configuration usually
involves pointing the host environment to the compiled server script.

Example configuration snippet (e.g., in `mcp_settings.json` for Roo/Cline):

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "node",
      "args": [
        "c:\\path\\to\\your\\project\\filesystem-mcp\\build\\index.js"
      ],
      "disabled": false,
      "alwaysAllow": [
        "list_files",
        "stat_items",
        "read_content",
        "write_content",
        "delete_items",
        "create_directories",
        "chmod_items",
        "chown_items",
        "move_items",
        "copy_items",
        "search_files",
        "replace_content"
      ],
      "env": {
        // Optional: Used by some hosts to trigger restarts on change
        "RELOAD_TRIGGER": "some_value"
      }
    }
  }
}
```

Replace the path in `"args"` with the correct absolute path to the compiled
`build/index.js` on your system. The `alwaysAllow` list specifies which tools
the agent can use without explicit user confirmation each time (configure
according to your security preferences).
