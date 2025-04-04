# Filesystem MCP Server (@shtse8/filesystem-mcp)

[![npm version](https://badge.fury.io/js/%40shtse8%2Ffilesystem-mcp.svg)](https://badge.fury.io/js/%40shtse8%2Ffilesystem-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/shtse8/filesystem-mcp.svg)](https://hub.docker.com/r/shtse8/filesystem-mcp)

<!-- Add other badges like License, Build Status if applicable -->

**Empower your AI agents (like Cline/Claude) with secure, efficient, and
token-saving access to your project files.**

This Node.js server implements the
[Model Context Protocol (MCP)](https://docs.modelcontextprotocol.com/) to
provide a robust set of filesystem tools, operating safely within a defined
project root directory.

---

## ⭐ Why Use This Server?

- **🛡️ Secure & Convenient Project Root Focus:**
  - All operations are **strictly confined to the project root directory**,
    preventing unauthorized access.
  - Uses **relative paths** from the project root, eliminating the need for the
    AI or user to manage complex absolute paths or worry about the current
    working directory (CWD).
- **⚡ Optimized & Consolidated Tools:**
  - Most tools support **batch operations** (e.g., reading multiple files,
    deleting multiple items) in a single request.
  - Designed to **reduce AI-server round trips**, minimizing token usage and
    latency compared to executing individual commands for each file operation.
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
        "@shtse8/filesystem-mcp"
      ],
      "name": "Filesystem (npx)"
    }
  }
}
```

**That's it!** Restart your MCP Host environment (if necessary) for the settings
to take effect. Your AI agent can now use the filesystem tools. The server
automatically determines the project root based on where the host environment
runs it (typically your open project folder).

---

## ✨ Features

Provides a comprehensive, batch-capable toolset:

- 📁 **Listing & Status:** `list_files`, `stat_items`
- 📄 **Content Manipulation:** `read_content`, `write_content` (incl. append)
- ✏️ **Search & Replace:** `search_files` (regex), `replace_content`
- 🏗️ **Directory Management:** `create_directories`
- 🗑️ **Deletion:** `delete_items` (recursive)
- ↔️ **Moving & Copying:** `move_items`, `copy_items`
- 🔒 **Permissions:** `chmod_items`, `chown_items` (POSIX focused)

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
        "shtse8/filesystem-mcp:latest"
      ],
      "name": "Filesystem (Docker)"
    }
  }
}
```

**Explanation:**

- `-v "/path/to/your/project:/app"`: Mounts your local project directory into
  the container at `/app`. The server inside the container will treat `/app` as
  its root. **Remember to use the correct absolute path for your system.**
- `shtse8/filesystem-mcp:latest`: Specifies the Docker image. Docker will pull
  it if needed.

**3. Restart your MCP Host environment.**

---

## 🛠️ Other Usage Options

### Local Build (For Development)

1. Clone: `git clone https://github.com/shtse8/filesystem-mcp.git`
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
   [npm](https://www.npmjs.com/package/@shtse8/filesystem-mcp) on pushes to
   `main`.
2. Build and push a Docker image to
   [Docker Hub](https://hub.docker.com/r/shtse8/filesystem-mcp) on pushes to
   `main`.

Requires `NPM_TOKEN`, `DOCKERHUB_USERNAME`, and `DOCKERHUB_TOKEN` secrets
configured in the GitHub repository settings.

---

## 🙌 Contributing

Contributions are welcome! Please open an issue or submit a pull request.
