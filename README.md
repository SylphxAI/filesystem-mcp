# Filesystem MCP Server (@sylphlab/filesystem-mcp)

[![npm version](https://badge.fury.io/js/%40sylphlab%2Ffilesystem-mcp.svg)](https://badge.fury.io/js/%40sylphlab%2Ffilesystem-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/sylphlab/filesystem-mcp.svg)](https://hub.docker.com/r/sylphlab/filesystem-mcp)

<!-- Add other badges like License, Build Status if applicable -->
<a href="https://glama.ai/mcp/servers/@sylphlab/filesystem-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@sylphlab/filesystem-mcp/badge" />
</a>

**Empower your AI agents (like Cline/Claude) with secure, efficient, and token-saving access to your project files.** This Node.js server implements the [Model Context Protocol (MCP)](https://docs.modelcontextprotocol.com/) to provide a robust set of filesystem tools, operating safely within a defined project root directory.

## Installation

There are several ways to use the Filesystem MCP Server:

**1. Recommended: `npx` (or `bunx`) via MCP Host Configuration**

The simplest way is via `npx` or `bunx`, configured directly in your MCP host environment (e.g., Roo/Cline's `mcp_settings.json`). This ensures you always use the latest version from npm without needing local installation or Docker.

_Example (`npx`):_

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "npx",
      "args": ["@sylphlab/filesystem-mcp"],
      "name": "Filesystem (npx)"
    }
  }
}
```

_Example (`bunx`):_

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "bunx",
      "args": ["@sylphlab/filesystem-mcp"],
      "name": "Filesystem (bunx)"
    }
  }
}
```

**Important:** The server uses its own Current Working Directory (`cwd`) as the project root. Ensure your MCP Host (e.g., Cline/VSCode) is configured to launch the command with the `cwd` set to your active project's root directory.

**2. Docker**

Use the official Docker image for containerized environments.

_Example MCP Host Configuration:_

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
        "/path/to/your/project:/app", // Mount your project to /app
        "sylphlab/filesystem-mcp:latest"
      ],
      "name": "Filesystem (Docker)"
    }
  }
}
```

**Remember to replace `/path/to/your/project` with the correct absolute path.**

**3. Local Build (For Development)**

1.  Clone: `git clone https://github.com/sylphlab/filesystem-mcp.git`
2.  Install: `cd filesystem-mcp && pnpm install` (Using pnpm now)
3.  Build: `pnpm run build`
4.  Configure MCP Host:
    ```json
    {
      "mcpServers": {
        "filesystem-mcp": {
          "command": "node",
          "args": ["/path/to/cloned/repo/filesystem-mcp/dist/index.js"], // Updated build dir
          "name": "Filesystem (Local Build)"
        }
      }
    }
    ```
    **Note:** Launch the `node` command from the directory you intend as the project root.

## Quick Start

Once the server is configured in your MCP host (see Installation), your AI agent can immediately start using the filesystem tools.

_Example Agent Interaction (Conceptual):_

```
Agent: <use_mcp_tool>
         <server_name>filesystem-mcp</server_name>
         <tool_name>read_content</tool_name>
         <arguments>{"paths": ["src/index.ts"]}</arguments>
       </use_mcp_tool>

Server Response: (Content of src/index.ts)
```

## Why Choose This Project?

- **🛡️ Secure & Convenient Project Root Focus:** Operations confined to the project root (`cwd` at launch).
- **⚡ Optimized & Consolidated Tools:** Batch operations reduce AI-server round trips, saving tokens and latency. Reliable results for each item in a batch.
- **🚀 Easy Integration:** Quick setup via `npx`/`bunx`.
- **🐳 Containerized Option:** Available as a Docker image.
- **🔧 Comprehensive Functionality:** Covers a wide range of filesystem tasks.
- **✅ Robust Validation:** Uses Zod schemas for argument validation.

## Performance Advantages

_(Placeholder: Add benchmark results and comparisons here, demonstrating advantages over alternative methods like individual shell commands.)_

- **Batch Operations:** Significantly reduces overhead compared to single operations.
- **Direct API Usage:** More efficient than spawning shell processes for each command.
- _(Add specific benchmark data when available)_

## Features

This server equips your AI agent with a powerful and efficient filesystem toolkit:

- 📁 **Explore & Inspect (`list_files`, `stat_items`):** List files/directories (recursive, stats), get detailed status for multiple items.
- 📄 **Read & Write Content (`read_content`, `write_content`):** Read/write/append multiple files, creates parent directories.
- ✏️ **Precision Editing & Searching (`edit_file`, `search_files`, `replace_content`):** Surgical edits (insert, replace, delete) across multiple files with indentation preservation and diff output; regex search with context; multi-file search/replace.
- 🏗️ **Manage Directories (`create_directories`):** Create multiple directories including intermediate parents.
- 🗑️ **Delete Safely (`delete_items`):** Remove multiple files/directories recursively.
- ↔️ **Move & Copy (`move_items`, `copy_items`):** Move/rename/copy multiple files/directories.
- 🔒 **Control Permissions (`chmod_items`, `chown_items`):** Change POSIX permissions and ownership for multiple items.

**Key Benefit:** All tools accepting multiple paths/operations process each item individually and return a detailed status report.

## Design Philosophy

_(Placeholder: Explain the core design principles.)_

- **Security First:** Prioritize preventing access outside the project root.
- **Efficiency:** Minimize communication overhead and token usage for AI interactions.
- **Robustness:** Provide detailed results and error reporting for batch operations.
- **Simplicity:** Offer a clear and consistent API via MCP.
- **Standard Compliance:** Adhere strictly to the Model Context Protocol.

## Comparison with Other Solutions

_(Placeholder: Objectively compare with alternatives.)_

| Feature/Aspect          | Filesystem MCP Server | Individual Shell Commands (via Agent) | Other Custom Scripts |
| :---------------------- | :-------------------- | :------------------------------------ | :------------------- |
| **Security**            | High (Root Confined)  | Low (Agent needs shell access)        | Variable             |
| **Efficiency (Tokens)** | High (Batching)       | Low (One command per op)              | Variable             |
| **Latency**             | Low (Direct API)      | High (Shell spawn overhead)           | Variable             |
| **Batch Operations**    | Yes (Most tools)      | No                                    | Maybe                |
| **Error Reporting**     | Detailed (Per item)   | Basic (stdout/stderr parsing)         | Variable             |
| **Setup**               | Easy (npx/Docker)     | Requires secure shell setup           | Custom               |

## Future Plans

_(Placeholder: List upcoming features or improvements.)_

- Explore file watching capabilities.
- Investigate streaming support for very large files.
- Enhance performance for specific operations.
- Add more advanced filtering options for `list_files`.

## Documentation

_(Placeholder: Add link to the full documentation website once available.)_

Full documentation, including detailed API references and examples, will be available at: [Link to Docs Site]

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on the [GitHub repository](https://github.com/sylphlab/filesystem-mcp).

## License

This project is released under the [MIT License](LICENSE).

---

## Development

1. Clone: `git clone https://github.com/sylphlab/filesystem-mcp.git`
2. Install: `cd filesystem-mcp && pnpm install`
3. Build: `pnpm run build` (compiles TypeScript to `dist/`)
4. Watch: `pnpm run dev` (optional, recompiles on save)

## Publishing (via GitHub Actions)

This repository uses GitHub Actions (`.github/workflows/publish.yml`) to automatically publish the package to [npm](https://www.npmjs.com/package/@sylphlab/filesystem-mcp) and build/push a Docker image to [Docker Hub](https://hub.docker.com/r/sylphlab/filesystem-mcp) on pushes of version tags (`v*.*.*`) to the `main` branch. Requires `NPM_TOKEN`, `DOCKERHUB_USERNAME`, and `DOCKERHUB_TOKEN` secrets configured in the GitHub repository settings.
