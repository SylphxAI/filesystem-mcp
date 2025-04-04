#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

// Import handlers (use .js extension for ES modules)
import { handleListFiles } from './handlers/listFiles.js';
import { handleStatItems } from './handlers/statItems.js';
import { handleReadContent } from './handlers/readContent.js';
import { handleWriteContent } from './handlers/writeContent.js';
import { handleDeleteItems } from './handlers/deleteItems.js';
import { handleCreateDirectories } from './handlers/createDirectories.js';
import { handleChmodItems } from './handlers/chmodItems.js';
import { handleChownItems } from './handlers/chownItems.js';
import { handleMoveItems } from './handlers/moveItems.js';
import { handleCopyItems } from './handlers/copyItems.js';
import { handleSearchFiles } from './handlers/searchFiles.js';
import { handleReplaceContent } from './handlers/replaceContent.js';

// --- Tool Definitions (v0.2.0) ---
// (Keep tool definitions here for clarity or move them to a separate definitions file if preferred)

const listFilesTool = { name: "list_files", description: "List files/directories. Can optionally include stats and list recursively.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path of the directory.", default: "." }, recursive: { type: "boolean", description: "List directories recursively.", default: false }, include_stats: { type: "boolean", description: "Include detailed stats for each listed item.", default: false } }, required: [] } };
const statItemsTool = { name: "stat_items", description: "Get detailed status information for multiple specified paths.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "An array of relative paths (files or directories) to get status for." } }, required: ["paths"] } };
const readContentTool = { name: "read_content", description: "Read content from multiple specified files.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "Array of relative file paths to read." } }, required: ["paths"] } };
const writeContentTool = { name: "write_content", description: "Write or append content to multiple specified files (creating directories if needed).", inputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { path: { type: "string", description: "Relative path for the file." }, content: { type: "string", description: "Content to write." }, append: { type: "boolean", description: "Append content instead of overwriting.", default: false } }, required: ["path", "content"] }, description: "Array of {path, content, append?} objects." } }, required: ["items"] } };
const deleteItemsTool = { name: "delete_items", description: "Delete multiple specified files or directories.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "An array of relative paths (files or directories) to delete." } }, required: ["paths"] } };
const createDirectoriesTool = { name: "create_directories", description: "Create multiple specified directories (including intermediate ones).", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "An array of relative directory paths to create." } }, required: ["paths"] } };
const chmodItemsTool = { name: "chmod_items", description: "Change permissions mode for multiple specified files/directories (POSIX-style).", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "An array of relative paths." }, mode: { type: "string", description: "The permission mode as an octal string (e.g., '755', '644')." } }, required: ["paths", "mode"] } };
const chownItemsTool = { name: "chown_items", description: "Change owner (UID) and group (GID) for multiple specified files/directories.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "An array of relative paths." }, uid: { type: "number", description: "User ID." }, gid: { type: "number", description: "Group ID." } }, required: ["paths", "uid", "gid"] } };
const moveItemsTool = { name: "move_items", description: "Move or rename multiple specified files/directories.", inputSchema: { type: "object", properties: { operations: { type: "array", items: { type: "object", properties: { source: { type: "string", description: "Relative path of the source." }, destination: { type: "string", description: "Relative path of the destination." } }, required: ["source", "destination"] }, description: "Array of {source, destination} objects." } }, required: ["operations"] } };
const copyItemsTool = { name: "copy_items", description: "Copy multiple specified files/directories.", inputSchema: { type: "object", properties: { operations: { type: "array", items: { type: "object", properties: { source: { type: "string", description: "Relative path of the source." }, destination: { type: "string", description: "Relative path of the destination." } }, required: ["source", "destination"] }, description: "Array of {source, destination} objects." } }, required: ["operations"] } };
const searchFilesTool = { name: "search_files", description: "Search for a regex pattern within files in a specified directory (read-only).", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path of the directory to search in.", default: "." }, regex: { type: "string", description: "The regex pattern to search for." }, file_pattern: { type: "string", description: "Glob pattern to filter files (e.g., '*.ts'). Defaults to all files ('*').", default: "*" } }, required: ["regex"] } };
const replaceContentTool = { name: "replace_content", description: "Replace content within files across multiple specified paths.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "An array of relative file paths to perform replacements on." }, operations: { type: "array", items: { type: "object", properties: { search: { type: "string", description: "Text or regex pattern to search for." }, replace: { type: "string", description: "Text to replace matches with." }, use_regex: { type: "boolean", description: "Treat search as regex.", default: false }, ignore_case: { type: "boolean", description: "Ignore case during search.", default: false } }, required: ["search", "replace"] }, description: "An array of search/replace operations to apply to each file." } }, required: ["paths", "operations"] } };

// --- Server Setup ---

const server = new Server(
  {
    name: "filesystem-mcp",
    version: "0.2.1", // Increment version for refactor
    description: "MCP Server for filesystem operations relative to the project root."
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const availableTools = [
    listFilesTool,
    statItemsTool,
    readContentTool,
    writeContentTool,
    deleteItemsTool,
    createDirectoriesTool,
    chmodItemsTool,
    chownItemsTool,
    moveItemsTool,
    copyItemsTool,
    searchFilesTool,
    replaceContentTool,
  ];
  return { tools: availableTools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Use imported handlers
  switch (request.params.name) {
    case listFilesTool.name: return handleListFiles(request.params.arguments);
    case statItemsTool.name: return handleStatItems(request.params.arguments);
    case readContentTool.name: return handleReadContent(request.params.arguments);
    case writeContentTool.name: return handleWriteContent(request.params.arguments);
    case deleteItemsTool.name: return handleDeleteItems(request.params.arguments);
    case createDirectoriesTool.name: return handleCreateDirectories(request.params.arguments);
    case chmodItemsTool.name: return handleChmodItems(request.params.arguments);
    case chownItemsTool.name: return handleChownItems(request.params.arguments);
    case moveItemsTool.name: return handleMoveItems(request.params.arguments);
    case copyItemsTool.name: return handleCopyItems(request.params.arguments);
    case searchFilesTool.name: return handleSearchFiles(request.params.arguments);
    case replaceContentTool.name: return handleReplaceContent(request.params.arguments);
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
  }
});

// --- Server Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Filesystem MCP] Server running on stdio');
}

main().catch((error) => {
  console.error("[Filesystem MCP] Server error:", error);
  process.exit(1);
});
