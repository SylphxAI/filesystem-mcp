# Filesystem MCP Server (@shtse8/filesystem-mcp)

[![npm version](https://badge.fury.io/js/%40shtse8%2Ffilesystem-mcp.svg)](https://badge.fury.io/js/%40shtse8%2Ffilesystem-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/shtse8/filesystem-mcp.svg)](https://hub.docker.com/r/shtse8/filesystem-mcp)

<!-- Add other badges like License, Build Status if applicable -->

**Empower your AI agents (like Cline/Claude) with secure and controlled access
to your project files.**

This Node.js server implements the
[Model Context Protocol (MCP)](https://docs.modelcontextprotocol.com/) to
provide a robust set of filesystem tools, operating safely within a defined
project root directory.

---

## ✨ Features

- **Secure by Design:** All operations are strictly confined to the project root
  directory, preventing unauthorized access.
- **Comprehensive Toolset:** Offers a wide range of filesystem operations:
  - 📁 **Listing & Status:** `list_files`, `stat_items`
  - 📄 **Content Manipulation:** `read_content`, `write_content` (incl. append)
  - ✏️ **Search & Replace:** `search_files` (regex), `replace_content`
  - 🏗️ **Directory Management:** `create_directories`
  - 🗑️ **Deletion:** `delete_items` (recursive)
  - ↔️ **Moving & Copying:** `move_items`, `copy_items`
  - 🔒 **Permissions:** `chmod_items`, `chown_items` (POSIX focused)
- **Modern Tech:** Built with TypeScript, Node.js, and the
  `@modelcontextprotocol/sdk`.
- **Input Validation:** Uses Zod schemas for reliable tool argument validation.
- **Containerized:** Available as a Docker image on Docker Hub for easy
  deployment.

---

## 🚀 Quick Start: Usage with MCP Host (Recommended: Docker)

The easiest way to use this server is via Docker, configured directly in your
MCP host environment (e.g., Roo/Cline's `mcp_settings.json`).

**1. Ensure Docker is running.**

**2. Configure your MCP Host:**

Modify your MCP host's settings (e.g., `mcp_settings.json`) to run the Docker
container. **Crucially, you must mount your project directory to `/app` inside
the container.**

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      // Use 'docker' as the command
      "command": "docker",
      // Arguments for 'docker run'
      "args": [
        "run",
        "-i", // Keep STDIN open for stdio communication
        "--rm", // Automatically remove the container on exit
        // Mount your project directory to /app in the container
        // IMPORTANT: Replace '/path/to/your/project' with the ACTUAL path on your machine
        "-v",
        "/path/to/your/project:/app",
        // Specify the Docker image from Docker Hub
        "shtse8/filesystem-mcp:latest" // Or a specific version like shtse8/filesystem-mcp:0.4.3
      ],
      // Optional: Set a friendly name for the server in your host UI
      "name": "Filesystem (Docker)"
      // "disabled": false // Usually not needed unless you want to temporarily disable it
    }
  }
}
```

**Explanation of `docker run` arguments:**

- `run`: Executes the container.
- `-i`: Keeps STDIN open, essential for MCP communication over stdio.
- `--rm`: Cleans up the container after it stops.
- `-v "/path/to/your/project:/app"`: **The most important part!** Mounts your
  local project directory into the container at `/app`. The server inside the
  container will treat `/app` as its root and operate on your mounted files.
  **Remember to use the correct absolute path for your system.**
- `shtse8/filesystem-mcp:latest`: Specifies the Docker image to use. Docker will
  automatically pull it from Docker Hub if it's not present locally.

**3. Restart your MCP Host environment** (if necessary) for the settings to take
effect.

Your AI agent can now use the filesystem tools provided by the server running
inside Docker!

---

## 🛠️ Alternative Usage Options

While Docker is recommended, other options exist:

### Option 2: Using `npx`

Runs the latest version directly from npm. Good for quick tests.

```json
// mcp_settings.json example
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "npx",
      "args": ["@shtse8/filesystem-mcp"],
      "name": "Filesystem (npx)"
    }
  }
}
```

### Option 3: Local Build

For development or specific needs.

1. Clone: `git clone https://github.com/shtse8/filesystem-mcp.git`
2. Install: `cd filesystem-mcp && npm install`
3. Build: `npm run build`
4. Configure MCP Host:

```json
// mcp_settings.json example
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "node",
      // Use the absolute path to the build output
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
