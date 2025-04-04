#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { promises as fs, Stats } from "fs"; // Use promise-based fs, import Stats type
import path from "path";
import { fileURLToPath } from 'url'; // To get __dirname in ES modules
import { glob, Path } from 'glob'; // Import glob and Path type
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

// --- Configuration and Helpers ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

console.log(`[Filesystem MCP] Project Root determined as: ${PROJECT_ROOT}`);

const resolvePath = (userPath: string): string => {
  if (typeof userPath !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Path must be a string.');
  }
  const normalizedUserPath = path.normalize(userPath);
  if (path.isAbsolute(normalizedUserPath)) {
      throw new McpError(ErrorCode.InvalidParams, 'Absolute paths are not allowed.');
  }
  const resolved = path.resolve(PROJECT_ROOT, normalizedUserPath);
  if (!resolved.startsWith(PROJECT_ROOT)) {
      throw new McpError(ErrorCode.InvalidRequest, 'Path traversal detected. Access denied.');
  }
  return resolved;
};

// Helper to format stats object
const formatStats = (relativePath: string, absolutePath: string, stats: Stats) => {
    const modeOctal = (stats.mode & 0o777).toString(8).padStart(3, '0');
    return {
        path: relativePath.replace(/\\/g, '/'), // Ensure forward slashes
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymbolicLink: stats.isSymbolicLink(),
        size: stats.size,
        atime: stats.atime.toISOString(),
        mtime: stats.mtime.toISOString(),
        ctime: stats.ctime.toISOString(),
        birthtime: stats.birthtime.toISOString(),
        mode: modeOctal,
        uid: stats.uid,
        gid: stats.gid,
    };
};

// --- Tool Definitions ---
// (Concise definitions)
const listFilesTool = { name: "list_files", description: "List files/directories or get stats for a single item. Can optionally include stats for listed items and list recursively.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path of the file or directory.", default: "." }, recursive: { type: "boolean", description: "List directories recursively.", default: false }, include_stats: { type: "boolean", description: "Include detailed stats for each listed item.", default: false } }, required: [] } };
const readFileTool = { name: "read_file", description: "Read the content of a file relative to the project root.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path of the file." } }, required: ["path"] } };
const writeFileTool = { name: "write_file", description: "Write content to a file relative to the project root. Creates directories if needed. Overwrites existing files.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path for the file." }, content: { type: "string", description: "Content to write." } }, required: ["path", "content"] } };
const readMultipleFilesTool = { name: "read_multiple_files", description: "Read the content of multiple files relative to the project root.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "Array of relative file paths." } }, required: ["paths"] } };
const writeMultipleFilesTool = { name: "write_multiple_files", description: "Write content to multiple files relative to the project root.", inputSchema: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string", description: "Relative path." }, content: { type: "string", description: "Content." } }, required: ["path", "content"] }, description: "Array of {path, content} objects." } }, required: ["files"] } };
const deleteItemsTool = { name: "delete_items", description: "Delete multiple files or directories relative to the project root.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "An array of relative paths (files or directories) to delete." } }, required: ["paths"] } };
const createDirectoriesTool = { name: "create_directories", description: "Create multiple directories relative to the project root.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "An array of relative directory paths to create (including intermediate directories)." } }, required: ["paths"] } };
const searchAndReplaceTool = { name: "search_and_replace", description: "Perform search and replace operations on a single file relative to the project root.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path of the file to modify." }, operations: { type: "array", items: { type: "object", properties: { search: { type: "string", description: "Text or regex pattern to search for." }, replace: { type: "string", description: "Text to replace matches with." }, use_regex: { type: "boolean", description: "Treat search as regex.", default: false }, ignore_case: { type: "boolean", description: "Ignore case during search.", default: false }, start_line: { type: "number", description: "Start line number (1-based) for replacement range." }, end_line: { type: "number", description: "End line number (1-based, inclusive) for replacement range." } }, required: ["search", "replace"] }, description: "An array of search/replace operations." } }, required: ["path", "operations"] } };
const searchFilesTool = { name: "search_files", description: "Search for a regex pattern within files in a specified directory relative to the project root.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path of the directory to search in.", default: "." }, regex: { type: "string", description: "The regex pattern to search for." }, file_pattern: { type: "string", description: "Glob pattern to filter files (e.g., '*.ts'). Defaults to all files ('*').", default: "*" } }, required: ["regex"] } };
const searchAndReplaceMultipleFilesTool = { name: "search_and_replace_multiple_files", description: "Perform search and replace operations on multiple files within a directory.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path of the directory to search in.", default: "." }, file_pattern: { type: "string", description: "Glob pattern to filter files (e.g., '*.ts'). Defaults to all files ('*').", default: "*" }, operations: { type: "array", items: { type: "object", properties: { search: { type: "string", description: "Text or regex pattern to search for." }, replace: { type: "string", description: "Text to replace matches with." }, use_regex: { type: "boolean", description: "Treat search as regex.", default: false }, ignore_case: { type: "boolean", description: "Ignore case during search.", default: false } }, required: ["search", "replace"] }, description: "An array of search/replace operations to apply to each file." } }, required: ["operations"] } };
const chmodTool = { name: "chmod", description: "Change the permissions mode of a file or directory (POSIX-style). Accepts octal string like '755'.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path of the file or directory." }, mode: { type: "string", description: "The permission mode as an octal string (e.g., '755', '644')." } }, required: ["path", "mode"] } };
const moveItemTool = { name: "move_item", description: "Move or rename a file or directory relative to the project root.", inputSchema: { type: "object", properties: { source: { type: "string", description: "Relative path of the source file or directory." }, destination: { type: "string", description: "Relative path of the destination." } }, required: ["source", "destination"] } };

// --- Tool Handlers ---

const handleListFiles = async (args: any) => {
  const relativeInputPath = args?.path ?? ".";
  const recursive = args?.recursive ?? false;
  const includeStats = args?.include_stats ?? false;
  const targetAbsolutePath = resolvePath(relativeInputPath); // Absolute path of the item requested

  try {
    const initialStats = await fs.stat(targetAbsolutePath);

    // Case 1: Path points to a file
    if (initialStats.isFile()) {
      // Return stats for the single file
      const statsResult = formatStats(relativeInputPath, targetAbsolutePath, initialStats);
      return { content: [{ type: "text", text: JSON.stringify(statsResult, null, 2) }] };
    }

    // Case 2: Path points to a directory
    if (initialStats.isDirectory()) {
      let results: { path: string; stats?: ReturnType<typeof formatStats> | { error: string } }[] = [];
      // Construct glob pattern relative to PROJECT_ROOT
      const globPattern = path.join(relativeInputPath, recursive ? '**/*' : '*').replace(/\\/g, '/');
      const globOptions = {
          cwd: PROJECT_ROOT, // Run glob from project root
          dot: true,
          mark: true,
          nodir: false, // Always get dirs to check type later if needed
          stat: includeStats,
          withFileTypes: !includeStats,
          absolute: true // Get absolute paths from glob to avoid confusion
      };

      const absolutePathsFromGlob = await glob(globPattern, globOptions) as (string | Path)[];

      for (const entry of absolutePathsFromGlob) {
          let fullEntryPath: string;
          let entryStats: Stats | undefined;
          let isDirectory: boolean | undefined;

          // Determine the absolute path and potentially stats from the glob result
          if (typeof entry === 'string') {
              fullEntryPath = entry; // Already absolute
              isDirectory = entry.endsWith('/');
          } else if (typeof entry === 'object' && entry !== null && 'fullpath' in entry && typeof entry.fullpath === 'function') {
              // If it's a Path object (from stat:true or withFileTypes:true)
              fullEntryPath = entry.fullpath(); // Use the method to get absolute path
              if ('stats' in entry) {
                  entryStats = (entry as any).stats; // Stats might be attached
                  isDirectory = entryStats?.isDirectory();
              } else if (typeof (entry as any).isDirectory === 'function') {
                  isDirectory = (entry as any).isDirectory(); // Check type if stats weren't requested/available
              }
          } else {
              console.warn(`[Filesystem MCP] Unexpected entry type from glob:`, entry);
              continue;
          }

          // Calculate the path relative to the *original requested directory* for output consistency
          const entryRelativePath = path.relative(targetAbsolutePath, fullEntryPath);

          // Skip the base directory itself in recursive results
          if (entryRelativePath === '' || entryRelativePath === '.') continue;

          // Clean up path for output key, ensure forward slashes
          const itemPathOutput = entryRelativePath.replace(/\\/g, '/');
          const finalPathOutput = isDirectory ? `${itemPathOutput}/` : itemPathOutput;


          if (includeStats) {
              if (entryStats) {
                  results.push({ path: finalPathOutput, stats: formatStats(entryRelativePath, fullEntryPath, entryStats) });
              } else { // Fallback stat if needed
                  try {
                      const fallbackStats = await fs.stat(fullEntryPath);
                      isDirectory = fallbackStats.isDirectory(); // Update isDirectory based on fallback stat
                      results.push({ path: finalPathOutput, stats: formatStats(entryRelativePath, fullEntryPath, fallbackStats) });
                  } catch (statError: any) {
                      console.warn(`[Filesystem MCP] Could not stat ${fullEntryPath} during list with stats: ${statError.message}`);
                      results.push({ path: finalPathOutput, stats: { error: `Could not get stats: ${statError.message}` } });
                  }
              }
          } else { // Not including stats
              results.push({ path: finalPathOutput });
          }
      }
      const resultData = includeStats ? results : results.map(item => item.path);
      return { content: [{ type: "text", text: JSON.stringify(resultData, null, 2) }] };
    }
    throw new McpError(ErrorCode.InternalError, `Path is neither a file nor a directory: ${relativeInputPath}`);
  } catch (error: any) {
    if (error.code === 'ENOENT') throw new McpError(ErrorCode.InvalidRequest, `Path not found: ${relativeInputPath}`);
    if (error instanceof McpError) throw error;
    console.error(`[Filesystem MCP] Error in listFiles for ${targetAbsolutePath}:`, error);
    throw new McpError(ErrorCode.InternalError, `Failed to process path: ${error.message}`);
  }
};

const handleReadFile = async (args: any) => {
  const relativePath = args?.path;
  if (!relativePath) throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: path');
  const targetPath = resolvePath(relativePath);
  try {
    const stats = await fs.stat(targetPath);
    if (!stats.isFile()) throw new McpError(ErrorCode.InvalidRequest, `Path is not a file: ${relativePath}`);
    const content = await fs.readFile(targetPath, 'utf-8');
    return { content: [{ type: "text", text: content }] };
  } catch (error: any) {
    if (error.code === 'ENOENT') throw new McpError(ErrorCode.InvalidRequest, `File not found: ${relativePath}`);
    if (error instanceof McpError) throw error;
    console.error(`[Filesystem MCP] Error reading file ${targetPath}:`, error);
    throw new McpError(ErrorCode.InternalError, `Failed to read file: ${error.message}`);
  }
};

const handleWriteFile = async (args: any) => {
  const relativePath = args?.path;
  const content = args?.content;
  if (typeof relativePath !== 'string' || relativePath.trim() === '') throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: path');
  if (typeof content !== 'string') throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: content (must be a string)');
  const targetPath = resolvePath(relativePath);
  if (targetPath === PROJECT_ROOT) throw new McpError(ErrorCode.InvalidRequest, 'Writing directly to the project root is not allowed.');
  try {
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetPath, content, 'utf-8');
    return { content: [{ type: "text", text: `Successfully wrote to file: ${relativePath}` }] };
  } catch (error: any) {
    if (error instanceof McpError) throw error;
    console.error(`[Filesystem MCP] Error writing file ${targetPath}:`, error);
    throw new McpError(ErrorCode.InternalError, `Failed to write file: ${error.message}`);
  }
};

const handleReadMultipleFiles = async (args: any) => {
  const relativePaths = args?.paths;
  if (!Array.isArray(relativePaths) || relativePaths.length === 0 || !relativePaths.every(p => typeof p === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
  const results = await Promise.allSettled(relativePaths.map(async (relativePath) => {
    const targetPath = resolvePath(relativePath);
    try {
      const stats = await fs.stat(targetPath);
      if (!stats.isFile()) return { path: relativePath, error: `Path is not a file` };
      const content = await fs.readFile(targetPath, 'utf-8');
      return { path: relativePath, content: content };
    } catch (error: any) {
      if (error.code === 'ENOENT') return { path: relativePath, error: `File not found` };
      if (error instanceof McpError) return { path: relativePath, error: error.message };
      console.error(`[Filesystem MCP] Error reading file ${targetPath} in read_multiple_files:`, error);
      return { path: relativePath, error: `Failed to read file: ${error.message}` };
    }
  }));
  const outputContents = results.map(result => result.status === 'fulfilled' ? result.value : { path: 'unknown', error: 'Unexpected error during processing.' });
  return { content: [{ type: "text", text: JSON.stringify(outputContents, null, 2) }] };
};

const handleWriteMultipleFiles = async (args: any) => {
  const filesToWrite = args?.files;
  if (!Array.isArray(filesToWrite) || filesToWrite.length === 0 || !filesToWrite.every(f => typeof f === 'object' && typeof f.path === 'string' && typeof f.content === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: files (must be a non-empty array of {path: string, content: string} objects)');
  const results = await Promise.allSettled(filesToWrite.map(async (file) => {
    const relativePath = file.path;
    const content = file.content;
    const targetPath = resolvePath(relativePath);
    if (targetPath === PROJECT_ROOT) return { path: relativePath, success: false, error: 'Writing directly to the project root is not allowed.' };
    try {
      const targetDir = path.dirname(targetPath);
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(targetPath, content, 'utf-8');
      return { path: relativePath, success: true };
    } catch (error: any) {
      if (error instanceof McpError) return { path: relativePath, success: false, error: error.message };
      console.error(`[Filesystem MCP] Error writing file ${targetPath} in write_multiple_files:`, error);
      return { path: relativePath, success: false, error: `Failed to write file: ${error.message}` };
    }
  }));
  const outputResults = results.map(result => result.status === 'fulfilled' ? result.value : { path: 'unknown', success: false, error: 'Unexpected error during processing.' });
  return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};

const handleDeleteItems = async (args: any) => {
    const pathsToDelete = args?.paths;
    if (!Array.isArray(pathsToDelete) || pathsToDelete.length === 0 || !pathsToDelete.every(p => typeof p === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    const results = await Promise.allSettled(pathsToDelete.map(async (relativePath) => {
        const targetPath = resolvePath(relativePath);
        if (targetPath === PROJECT_ROOT) return { path: relativePath, success: false, error: 'Deleting the project root is not allowed.' };
        try {
            await fs.rm(targetPath, { recursive: true, force: true });
            return { path: relativePath, success: true };
        } catch (error: any) {
            if (error.code === 'ENOENT') return { path: relativePath, success: true, note: 'Path not found, nothing to delete' };
            if (error instanceof McpError) return { path: relativePath, success: false, error: error.message };
            console.error(`[Filesystem MCP] Error deleting item ${targetPath}:`, error);
            return { path: relativePath, success: false, error: `Failed to delete: ${error.message}` };
        }
    }));
    const outputResults = results.map(result => result.status === 'fulfilled' ? result.value : { path: 'unknown', success: false, error: 'Unexpected error during processing.' });
    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};

const handleCreateDirectories = async (args: any) => {
    const pathsToCreate = args?.paths;
    if (!Array.isArray(pathsToCreate) || pathsToCreate.length === 0 || !pathsToCreate.every(p => typeof p === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    const results = await Promise.allSettled(pathsToCreate.map(async (relativePath) => {
        const targetPath = resolvePath(relativePath);
        if (targetPath === PROJECT_ROOT) return { path: relativePath, success: false, error: 'Creating the project root is not allowed.' };
        try {
            await fs.mkdir(targetPath, { recursive: true });
            return { path: relativePath, success: true };
        } catch (error: any) {
             if (error.code === 'EEXIST') {
                 try {
                     const stats = await fs.stat(targetPath);
                     if (stats.isDirectory()) return { path: relativePath, success: true, note: 'Directory already exists' };
                     else return { path: relativePath, success: false, error: 'Path exists but is not a directory' };
                 } catch (statError: any) {
                     console.error(`[Filesystem MCP] Error stating existing path ${targetPath}:`, statError);
                     return { path: relativePath, success: false, error: `Failed to create directory: ${statError.message}` };
                 }
             }
            if (error instanceof McpError) return { path: relativePath, success: false, error: error.message };
            console.error(`[Filesystem MCP] Error creating directory ${targetPath}:`, error);
            return { path: relativePath, success: false, error: `Failed to create directory: ${error.message}` };
        }
    }));
    const outputResults = results.map(result => result.status === 'fulfilled' ? result.value : { path: 'unknown', success: false, error: 'Unexpected error during processing.' });
    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};

const handleSearchAndReplace = async (args: any) => {
    const relativePath = args?.path;
    const operations = args?.operations;
    if (typeof relativePath !== 'string' || relativePath.trim() === '') throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: path');
    if (!Array.isArray(operations) || operations.length === 0 || !operations.every((op: any) => typeof op === 'object' && typeof op.search === 'string' && typeof op.replace === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: operations (must be a non-empty array of {search: string, replace: string, ...} objects)');
    const targetPath = resolvePath(relativePath);
    let fileContent = '';
    try {
        const stats = await fs.stat(targetPath);
        if (!stats.isFile()) throw new McpError(ErrorCode.InvalidRequest, `Path is not a file: ${relativePath}`);
        fileContent = await fs.readFile(targetPath, 'utf-8');
    } catch (error: any) {
        if (error.code === 'ENOENT') throw new McpError(ErrorCode.InvalidRequest, `File not found: ${relativePath}`);
        if (error instanceof McpError) throw error;
        console.error(`[Filesystem MCP] Error reading file ${targetPath} for search/replace:`, error);
        throw new McpError(ErrorCode.InternalError, `Failed to read file for search/replace: ${error.message}`);
    }
    let modifiedContent = fileContent;
    const results: { operation: number; replacements: number; error?: string }[] = [];
    let operationIndex = 0;
    for (const op of operations) {
        operationIndex++;
        let replacementsCount = 0;
        try {
            const searchPattern = op.search;
            const replacementText = op.replace;
            const useRegex = op.use_regex ?? false;
            const ignoreCase = op.ignore_case ?? false;
            const startLine = op.start_line;
            const endLine = op.end_line;
            let regexFlags = 'g';
            if (ignoreCase) regexFlags += 'i';
            const searchRegex = useRegex ? new RegExp(searchPattern, regexFlags) : new RegExp(searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), regexFlags);
            if (startLine !== undefined || endLine !== undefined) {
                const lines = modifiedContent.split('\n');
                const effectiveStartLine = startLine === undefined ? 1 : Math.max(1, startLine);
                const effectiveEndLine = endLine === undefined ? lines.length : Math.min(lines.length, endLine);
                if (effectiveStartLine > effectiveEndLine) throw new Error(`Start line (${startLine}) cannot be greater than end line (${endLine}).`);
                for (let i = effectiveStartLine - 1; i < effectiveEndLine; i++) {
                    const originalLine = lines[i];
                    let lineReplacements = 0;
                    lines[i] = lines[i].replace(searchRegex, (...args) => { lineReplacements++; return replacementText; });
                    replacementsCount += lineReplacements;
                }
                modifiedContent = lines.join('\n');
            } else {
                 const matches = modifiedContent.match(searchRegex);
                 replacementsCount = matches ? matches.length : 0;
                 modifiedContent = modifiedContent.replace(searchRegex, replacementText);
            }
            results.push({ operation: operationIndex, replacements: replacementsCount });
        } catch (error: any) {
            console.error(`[Filesystem MCP] Error during search/replace operation ${operationIndex} on ${relativePath}:`, error);
            results.push({ operation: operationIndex, replacements: 0, error: `Operation failed: ${error.message}` });
        }
    }
    if (modifiedContent !== fileContent) {
        try { await fs.writeFile(targetPath, modifiedContent, 'utf-8'); }
        catch (error: any) {
            console.error(`[Filesystem MCP] Error writing modified file ${targetPath}:`, error);
            throw new McpError(ErrorCode.InternalError, `Failed to write modified file: ${error.message}`);
        }
    }
    return { content: [{ type: "text", text: JSON.stringify({ message: `Search and replace completed on ${relativePath}.`, results: results }, null, 2) }] };
};

const handleSearchFiles = async (args: any) => {
    const relativePath = args?.path ?? ".";
    const regexString = args?.regex;
    const filePattern = args?.file_pattern ?? "*";
    if (typeof regexString !== 'string' || regexString.trim() === '') throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: regex');
    const targetPath = resolvePath(relativePath);
    let searchRegex: RegExp;
    try { searchRegex = new RegExp(regexString); }
    catch (error: any) { throw new McpError(ErrorCode.InvalidParams, `Invalid regex pattern: ${error.message}`); }
    const results: { file: string; line: number; match: string; context: string[] }[] = [];
    const CONTEXT_LINES = 2;
    try {
        const globPattern = path.join(targetPath, '**', filePattern).replace(/\\/g, '/');
        const files = await glob(globPattern, { nodir: true, dot: true, ignore: [path.join(targetPath, '**/node_modules/**').replace(/\\/g, '/')] });
        for (const filePath of files) {
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                const lines = fileContent.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    let matchResult;
                    while ((matchResult = searchRegex.exec(line)) !== null) {
                        const match = matchResult[0];
                        const startContext = Math.max(0, i - CONTEXT_LINES);
                        const endContext = Math.min(lines.length, i + CONTEXT_LINES + 1);
                        const context = lines.slice(startContext, endContext);
                        results.push({ file: path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/'), line: i + 1, match: match, context: context });
                        if (!searchRegex.global) break;
                    }
                    if (searchRegex.global) searchRegex.lastIndex = 0;
                }
            } catch (readError: any) {
                if (readError.code !== 'ENOENT') console.warn(`[Filesystem MCP] Could not read or process file ${filePath} during search: ${readError.message}`);
            }
        }
    } catch (error: any) {
        if (error instanceof McpError) throw error;
        console.error(`[Filesystem MCP] Error searching files in ${targetPath}:`, error);
        throw new McpError(ErrorCode.InternalError, `Failed to search files: ${error.message}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
};

const handleSearchAndReplaceMultipleFiles = async (args: any) => {
    const relativePath = args?.path ?? ".";
    const filePattern = args?.file_pattern ?? "*";
    const operations = args?.operations;
    if (!Array.isArray(operations) || operations.length === 0 || !operations.every((op: any) => typeof op === 'object' && typeof op.search === 'string' && typeof op.replace === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: operations (must be a non-empty array of {search: string, replace: string, ...} objects)');
    const targetPath = resolvePath(relativePath);
    const fileProcessingResults: { file: string; replacements: number; modified: boolean; error?: string }[] = [];
    try {
        const globPattern = path.join(targetPath, '**', filePattern).replace(/\\/g, '/');
        const files = await glob(globPattern, { nodir: true, dot: true, ignore: [path.join(targetPath, '**/node_modules/**').replace(/\\/g, '/')] });
        for (const filePath of files) {
            const fileRelativePath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
            let fileContent = '';
            let originalContent = '';
            let totalReplacements = 0;
            let modified = false;
            let fileError: string | undefined = undefined;
            try {
                originalContent = await fs.readFile(filePath, 'utf-8');
                fileContent = originalContent;
                for (const op of operations) {
                    let replacementsInOp = 0;
                    const searchPattern = op.search;
                    const replacementText = op.replace;
                    const useRegex = op.use_regex ?? false;
                    const ignoreCase = op.ignore_case ?? false;
                    let regexFlags = 'g';
                    if (ignoreCase) regexFlags += 'i';
                    const searchRegex = useRegex ? new RegExp(searchPattern, regexFlags) : new RegExp(searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), regexFlags);
                    const matches = fileContent.match(searchRegex);
                    replacementsInOp = matches ? matches.length : 0;
                    if (replacementsInOp > 0) {
                        fileContent = fileContent.replace(searchRegex, replacementText);
                        totalReplacements += replacementsInOp;
                    }
                }
                if (fileContent !== originalContent) {
                    modified = true;
                    await fs.writeFile(filePath, fileContent, 'utf-8');
                }
            } catch (error: any) {
                 console.error(`[Filesystem MCP] Error processing file ${fileRelativePath} for multi-replace:`, error);
                 fileError = `Failed to process file: ${error.message}`;
            } finally {
                 fileProcessingResults.push({ file: fileRelativePath, replacements: totalReplacements, modified, error: fileError });
            }
        }
    } catch (error: any) {
        if (error instanceof McpError) throw error;
        console.error(`[Filesystem MCP] Error during multi-file search/replace in ${targetPath}:`, error);
        throw new McpError(ErrorCode.InternalError, `Failed during multi-file search/replace: ${error.message}`);
    }
    return {
        content: [{
            type: "text",
            text: JSON.stringify({ message: `Multi-file search and replace completed in '${relativePath}' matching '${filePattern}'.`, results: fileProcessingResults }, null, 2)
        }]
    };
};

const handleChmod = async (args: any) => {
    const relativePath = args?.path;
    const modeString = args?.mode;
    if (typeof relativePath !== 'string' || relativePath.trim() === '') throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: path');
    if (typeof modeString !== 'string' || !/^[0-7]{3,4}$/.test(modeString)) throw new McpError(ErrorCode.InvalidParams, 'Invalid required parameter: mode (must be an octal string like \'755\')');
    const targetPath = resolvePath(relativePath);
    if (targetPath === PROJECT_ROOT) throw new McpError(ErrorCode.InvalidRequest, 'Changing permissions of the project root is not allowed.');
    try {
        const mode = parseInt(modeString, 8);
        await fs.chmod(targetPath, mode);
        return { content: [{ type: "text", text: `Successfully changed mode of ${relativePath} to ${modeString}` }] };
    } catch (error: any) {
        if (error.code === 'ENOENT') throw new McpError(ErrorCode.InvalidRequest, `Path not found: ${relativePath}`);
        if (error instanceof McpError) throw error;
        console.error(`[Filesystem MCP] Error changing mode for ${targetPath}:`, error);
        throw new McpError(ErrorCode.InternalError, `Failed to change mode: ${error.message}`);
    }
};

const handleMoveItem = async (args: any) => {
    const sourceRelative = args?.source;
    const destinationRelative = args?.destination;
    if (typeof sourceRelative !== 'string' || sourceRelative.trim() === '') throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: source');
    if (typeof destinationRelative !== 'string' || destinationRelative.trim() === '') throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: destination');

    const sourceAbsolute = resolvePath(sourceRelative);
    const destinationAbsolute = resolvePath(destinationRelative);

    if (sourceAbsolute === PROJECT_ROOT) throw new McpError(ErrorCode.InvalidRequest, 'Moving the project root is not allowed.');
    if (destinationAbsolute === PROJECT_ROOT) throw new McpError(ErrorCode.InvalidRequest, 'Moving an item directly into the project root is not allowed.');

    try {
        // Ensure destination directory exists if moving into a directory
        const destStats = await fs.stat(destinationAbsolute).catch(() => null);
        if (destStats?.isDirectory()) {
             // If destination is a directory, move the source *into* it
             const finalDestination = path.join(destinationAbsolute, path.basename(sourceAbsolute));
             await fs.rename(sourceAbsolute, finalDestination);
             return { content: [{ type: "text", text: `Successfully moved '${sourceRelative}' to '${path.relative(PROJECT_ROOT, finalDestination).replace(/\\/g, '/')}'` }] };
        } else if (destStats?.isFile()) {
            // Overwriting files is allowed by fs.rename by default on most systems
            await fs.rename(sourceAbsolute, destinationAbsolute);
            return { content: [{ type: "text", text: `Successfully moved/renamed '${sourceRelative}' to '${destinationRelative}' (overwrote existing file)` }] };
        } else {
             // Destination does not exist, perform rename/move
             // Ensure parent directory of destination exists
             const destDir = path.dirname(destinationAbsolute);
             await fs.mkdir(destDir, { recursive: true });
             await fs.rename(sourceAbsolute, destinationAbsolute);
             return { content: [{ type: "text", text: `Successfully moved/renamed '${sourceRelative}' to '${destinationRelative}'` }] };
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') throw new McpError(ErrorCode.InvalidRequest, `Source path not found: ${sourceRelative}`);
        if (error.code === 'EPERM' || error.code === 'EACCES') throw new McpError(ErrorCode.InvalidRequest, `Permission denied moving '${sourceRelative}' to '${destinationRelative}'.`);
        // Consider handling EXDEV (cross-device link) by copying and deleting if needed
        if (error instanceof McpError) throw error;
        console.error(`[Filesystem MCP] Error moving item from ${sourceAbsolute} to ${destinationAbsolute}:`, error);
        throw new McpError(ErrorCode.InternalError, `Failed to move item: ${error.message}`);
    }
};

// --- Server Setup ---

const server = new Server(
  {
    name: "filesystem-mcp",
    version: "0.1.1", // Incremented version
    description: "MCP Server for filesystem operations relative to the project root."
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const availableTools = [
    listFilesTool,
    readFileTool,
    writeFileTool,
    readMultipleFilesTool,
    writeMultipleFilesTool,
    deleteItemsTool,
    createDirectoriesTool,
    searchAndReplaceTool,
    searchFilesTool,
    searchAndReplaceMultipleFilesTool,
    chmodTool,
    moveItemTool, // Added move tool
  ];
  return { tools: availableTools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case listFilesTool.name: return handleListFiles(request.params.arguments);
    case readFileTool.name: return handleReadFile(request.params.arguments);
    case writeFileTool.name: return handleWriteFile(request.params.arguments);
    case readMultipleFilesTool.name: return handleReadMultipleFiles(request.params.arguments);
    case writeMultipleFilesTool.name: return handleWriteMultipleFiles(request.params.arguments);
    case deleteItemsTool.name: return handleDeleteItems(request.params.arguments);
    case createDirectoriesTool.name: return handleCreateDirectories(request.params.arguments);
    case searchAndReplaceTool.name: return handleSearchAndReplace(request.params.arguments);
    case searchFilesTool.name: return handleSearchFiles(request.params.arguments);
    case searchAndReplaceMultipleFilesTool.name: return handleSearchAndReplaceMultipleFiles(request.params.arguments);
    case chmodTool.name: return handleChmod(request.params.arguments);
    case moveItemTool.name: return handleMoveItem(request.params.arguments); // Added handler case
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
