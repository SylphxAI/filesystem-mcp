# Project Brief: Filesystem MCP Server

## 1. Project Goal

The primary goal of this project is to create a Model Context Protocol (MCP)
server specifically designed for filesystem operations. This server should allow
an AI agent (like Cline) to interact with the user's filesystem in a controlled
and secure manner, operating relative to a defined project root directory.

## 2. Core Requirements

- **MCP Compliance:** The server must adhere to the Model Context Protocol
  specifications for communication.
- **Relative Pathing:** All filesystem operations must be strictly relative to
  the project root directory. Absolute paths should be disallowed, and path
  traversal attempts must be prevented.
- **Core Filesystem Tools:** Implement a comprehensive set of tools for common
  filesystem tasks:
  - `list_files`: List files and directories, with options for recursion and
    including stats.
  - `read_file`: Read the content of a specific file.
  - `write_file`: Write content to a specific file (creating directories if
    needed, overwriting existing files).
  - `read_multiple_files`: Read content from multiple files efficiently.
  - `write_multiple_files`: Write content to multiple files efficiently.
  - `delete_items`: Delete files or directories.
  - `create_directories`: Create directories (including intermediate ones).
  - `search_and_replace`: Perform search and replace operations within a single
    file.
  - `search_files`: Search for regex patterns across files in a directory.
  - `search_and_replace_multiple_files`: Perform search and replace across
    multiple files.
  - `chmod`: Change file/directory permissions (POSIX-style).
  - `move_item`: Move or rename files/directories.
- **Technology Stack:** Use Node.js and TypeScript. Leverage the
  `@modelcontextprotocol/sdk` for MCP implementation and `glob` for file
  searching/listing.
- **Efficiency:** Tools should be implemented efficiently, especially for
  operations involving multiple files or large directories.
- **Security:** Robust path resolution and validation are critical to prevent
  access outside the designated project root.

## 3. Scope

- **In Scope:** Implementation of the MCP server logic, definition of tool
  schemas, handling requests, performing filesystem operations via Node.js `fs`
  and `path` modules, and using `glob`. Basic error handling for common
  filesystem issues (e.g., file not found, permissions).
- **Out of Scope:** Advanced features like file watching, complex permission
  management beyond basic `chmod`, handling extremely large files requiring
  streaming (beyond basic read/write), or integration with version control
  systems.

## 4. Success Criteria

- The server compiles successfully using TypeScript.
- The server connects and responds to MCP requests (e.g., `list_tools`).
- All implemented tools function correctly according to their descriptions,
  respecting relative path constraints.
- Path traversal attempts are correctly blocked.
- The server handles basic errors gracefully (e.g., file not found).
