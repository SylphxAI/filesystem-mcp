# Filesystem MCP Server (@sylphlab/filesystem-mcp)

[![npm version](https://badge.fury.io/js/%40sylphlab%2Ffilesystem-mcp.svg)](https://badge.fury.io/js/%40sylphlab%2Ffilesystem-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/sylphlab/filesystem-mcp.svg)](https://hub.docker.com/r/sylphlab/filesystem-mcp)

<!-- Add other badges like License, Build Status if applicable -->
<a href="https://glama.ai/mcp/servers/@sylphlab/filesystem-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@sylphlab/filesystem-mcp/badge" />
</a>

**Empower your AI agents (like Cline/Claude) with secure, efficient, and
token-saving access to your project files.**

This Node.js server implements the
[Model Context Protocol (MCP)](https://docs.modelcontextprotocol.com/) to
provide a robust set of filesystem tools, operating safely within a defined
project root directory.

---

## ⭐ Why Use This Server?

- **🛡️ Secure & Convenient Project Root Focus:**
  - All operations are **strictly confined to the project root directory**
    (determined by the server's launch context), preventing unauthorized access.
  - Uses **relative paths** from the project root. **Important:** The server
    determines its project root from its own Current Working Directory (`cwd`)
    at launch. The process starting the server (e.g., your MCP host) **must**
    set the `cwd` to your intended project directory.
- **⚡ Optimized & Consolidated Tools:**
  - Most tools support **batch operations** (e.g., reading multiple files,
    deleting multiple items) in a single request.
  - Designed to **reduce AI-server round trips**, minimizing token usage and
    latency compared to executing individual commands for each file operation.
  - **Reliable Batch Processing:** All tools supporting multiple items (e.g.,
    `read_content`, `delete_items`, `edit_file`) attempt every operation and
    return a detailed result for each, indicating success or failure with
    specific error messages. This allows for robust error handling and follow-up
    actions.
- **🚀 Easy Integration:** Get started quickly using `npx` with minimal
  configuration.
- **🐳 Containerized Option:** Also available as a Docker image for consistent
  deployment environments.
- **🔧 Comprehensive Functionality:** Covers a wide range of common filesystem
  tasks (see Features below).
- **✅ Robust Validation:** Uses Zod schemas to validate all incoming tool
  arguments.

---

## 🚀 Quick Start: Usage with MCP Host (Recommended: `npx`)

The simplest and recommended way to use this server is via `npx`, configured
directly in your MCP host environment (e.g., Roo/Cline's `mcp_settings.json`).
This ensures you always use the latest version from npm without needing local
installation or Docker.

**Configure your MCP Host:**

Modify your MCP host's settings (e.g., `mcp_settings.json`) to run the server
using `npx`.

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "npx",
      "args": [
        "@sylphlab/filesystem-mcp"
      ],
      "name": "Filesystem (npx)"
    }
  }
}
```

**(Alternative) Using `bunx`:**

If you prefer using Bun, you can use `bunx` instead:

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "bunx",
      "args": [
        "@sylphlab/filesystem-mcp"
      ],
      "name": "Filesystem (bunx)"
    }
  }
}
```

**That's it!** Restart your MCP Host environment (if necessary) for the settings
to take effect. Your AI agent can now use the filesystem tools. **Important:**
The server uses its own Current Working Directory (`cwd`) as the project root.
Ensure your MCP Host (e.g., Cline/VSCode) is configured to launch the `npx` or
`bunx` command with the `cwd` set to your active project's root directory.

---

## ✨ Amazing Features & Tools

This server equips your AI agent with a powerful and efficient filesystem
toolkit:

- 📁 **Explore & Inspect (`list_files`, `stat_items`):**
  - `list_files`: Effortlessly list files and directories. Go deep with
    **recursive listing** or get detailed **file statistics** (size, type,
    timestamps) included directly in the results. Perfect for understanding
    project structure.
  - `stat_items`: Get detailed status information (size, type, permissions,
    timestamps) for **multiple files or directories** in a single call.

- 📄 **Read & Write Content (`read_content`, `write_content`):**
  - `read_content`: Read the full content of **multiple files** simultaneously.
    Ideal for fetching source code or configuration files efficiently.
  - `write_content`: Write content to **multiple files**, automatically creating
    necessary parent directories. Supports both **overwriting** and
    **appending** modes per file.

- ✏️ **Precision Editing & Searching (`edit_file`, `search_files`,
  `replace_content`):**
  - `edit_file`: Perform **surgical edits** across **multiple files**. Supports
    precise **insertion**, pattern-based **replacement**, and **deletion** of
    text blocks. Intelligently **preserves indentation** and provides **diff
    output** for review. _The ultimate tool for targeted code modifications!_
  - `search_files`: Unleash the power of **regex search** across entire
    directories. Find specific code patterns, comments, or any text, complete
    with surrounding context lines for each match. Filter by file patterns
    (e.g., `*.ts`).
  - `replace_content`: Perform **search-and-replace** operations (text or regex)
    across **multiple files** at once.

- 🏗️ **Manage Directories (`create_directories`):**
  - Create **multiple directories** in one go, including any necessary
    intermediate parent directories (`mkdir -p` style).

- 🗑️ **Delete Safely (`delete_items`):**
  - Remove **multiple files or directories recursively** with a single command.
    Handles non-existent paths gracefully.

- ↔️ **Move & Copy (`move_items`, `copy_items`):**
  - `move_items`: Rename or move **multiple files and directories**.
    Automatically creates destination parent directories if needed.
  - `copy_items`: Copy **multiple files and directories recursively**. Ensures
    destination directories exist.

- 🔒 **Control Permissions (`chmod_items`, `chown_items`):**
  - `chmod_items`: Change POSIX-style permissions (e.g., '755') for **multiple
    files/directories**.
  - `chown_items`: Change owner (UID) and group (GID) for **multiple
    files/directories** (effectiveness depends on OS and user privileges).

**Key Benefit:** All tools accepting multiple paths/operations process each item
individually and return a detailed status report, ensuring you know exactly what
succeeded and what failed, even within a single batch request!

---

## 🐳 Alternative Usage: Docker

For users who prefer containerization or need a specific environment.

**1. Ensure Docker is running.**

**2. Configure your MCP Host:**

Modify your MCP host's settings to run the Docker container. **Crucially, you
must mount your project directory to `/app` inside the container.**

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/path/to/your/project:/app",
        "sylphlab/filesystem-mcp:latest"
      ],
      "name": "Filesystem (Docker)"
    }
  }
}
```

**Explanation:**

- `-v "/path/to/your/project:/app"`: Mounts your local project directory into
  the container at `/app`. The server inside the container will treat `/app` as
  its root. **Remember to replace `/path/to/your/project` with the correct
  absolute path for your system.** (Note: Depending on your MCP host environment
  and shell, you _might_ be able to use variables like `$PWD` (Linux/macOS),
  `%CD%` (Windows Cmd), or `${workspaceFolder}` (if supported by the host)
  instead of the explicit path, but this is not guaranteed to work universally.)
- `sylphlab/filesystem-mcp:latest`: Specifies the Docker image. Docker will pull
  it if needed.

**3. Restart your MCP Host environment.**

---

## 🛠️ Other Usage Options

### Local Build (For Development)

1. Clone: `git clone https://github.com/sylphlab/filesystem-mcp.git`
2. Install: `cd filesystem-mcp && npm install`
3. Build: `npm run build`
4. Configure MCP Host:

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "node",
      "args": ["/path/to/cloned/repo/filesystem-mcp/build/index.js"],
      "name": "Filesystem (Local Build)"
    }
    
    **Note:** When running a local build directly with `node`, ensure you launch the command from the directory you intend to be the project root, as the server will use `process.cwd()` to determine its operational scope.
  }
}
```

---

## 💻 Development

1. Clone the repository.
2. Install dependencies: `npm install`
3. Build: `npm run build` (compiles TypeScript to `build/`)
4. Watch for changes: `npm run watch` (optional, recompiles on save)

---

## 🚢 Publishing (via GitHub Actions)

This repository uses GitHub Actions (`.github/workflows/publish.yml`) to
automatically:

1. Publish the package to
   [npm](https://www.npmjs.com/package/@sylphlab/filesystem-mcp) on pushes to
   `main`.
2. Build and push a Docker image to
   [Docker Hub](https://hub.docker.com/r/sylphlab/filesystem-mcp) on pushes to
   `main`.

Requires `NPM_TOKEN`, `DOCKERHUB_USERNAME`, and `DOCKERHUB_TOKEN` secrets
configured in the GitHub repository settings.

---

---

## ❤️ Support the Project

If you find this server useful, consider supporting its development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/shtse8)

---
## 🙌 Contributing

Contributions are welcome! Please open an issue or submit a pull request.
