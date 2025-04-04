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

// --- Tool Definitions (v0.2.0) ---

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

// Placeholder for the new stat_items handler
const handleStatItems = async (args: any) => {
    const pathsToStat = args?.paths;
    if (!Array.isArray(pathsToStat) || pathsToStat.length === 0 || !pathsToStat.every(p => typeof p === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    const results: any[] = []; // TODO: Implement actual stat logic
    await Promise.allSettled(pathsToStat.map(async (relativePath) => {
        try {
            const targetPath = resolvePath(relativePath);
            const stats = await fs.stat(targetPath);
            results.push({ path: relativePath.replace(/\\/g, '/'), status: 'success', stats: formatStats(relativePath, targetPath, stats) });
        } catch (error: any) {
            if (error.code === 'ENOENT') results.push({ path: relativePath.replace(/\\/g, '/'), status: 'error', error: 'Path not found' });
            else if (error instanceof McpError) results.push({ path: relativePath.replace(/\\/g, '/'), status: 'error', error: error.message });
            else {
                console.error(`[Filesystem MCP] Error stating item ${relativePath}:`, error);
                results.push({ path: relativePath.replace(/\\/g, '/'), status: 'error', error: `Failed to get stats: ${error.message}` });
            }
        }
    }));
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
};

const handleReadContent = async (args: any) => { // Renamed from handleReadMultipleFiles
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

const handleWriteContent = async (args: any) => { // Renamed from handleWriteMultipleFiles
  const filesToWrite = args?.files;
  if (!Array.isArray(filesToWrite) || filesToWrite.length === 0 || !filesToWrite.every(f => typeof f === 'object' && typeof f.path === 'string' && typeof f.content === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: items (must be a non-empty array of {path: string, content: string, append?: boolean} objects)');
  const results = await Promise.allSettled(filesToWrite.map(async (file) => {
    const relativePath = file.path;
    const content = file.content;
    const targetPath = resolvePath(relativePath);
    const append = file.append ?? false; // Check for append flag
    if (targetPath === PROJECT_ROOT) return { path: relativePath, success: false, error: 'Writing directly to the project root is not allowed.' };
    try {
      const targetDir = path.dirname(targetPath);
      await fs.mkdir(targetDir, { recursive: true });
      if (append) {
        await fs.appendFile(targetPath, content, 'utf-8');
      } else {
        await fs.writeFile(targetPath, content, 'utf-8');
      }
      return { path: relativePath, success: true, operation: append ? 'appended' : 'written' };
    } catch (error: any) {
      if (error instanceof McpError) return { path: relativePath, success: false, error: error.message };
      console.error(`[Filesystem MCP] Error writing file ${targetPath} in write_multiple_files:`, error);
      return { path: relativePath, success: false, error: `Failed to ${append ? 'append' : 'write'} file: ${error.message}` };
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

// Removed handleSearchAndReplace (superseded by handleReplaceContent)

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

const handleReplaceContent = async (args: any) => { // Renamed from handleSearchAndReplaceMultipleFiles
    const relativePaths = args?.paths;
    const operations = args?.operations;
    if (!Array.isArray(relativePaths) || relativePaths.length === 0 || !relativePaths.every(p => typeof p === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    if (!Array.isArray(operations) || operations.length === 0 || !operations.every((op: any) => typeof op === 'object' && typeof op.search === 'string' && typeof op.replace === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: operations (must be a non-empty array of {search: string, replace: string, use_regex?: boolean, ignore_case?: boolean} objects)');
    const fileProcessingResults: { file: string; replacements: number; modified: boolean; error?: string }[] = [];
    try {
        for (const relativePath of relativePaths) {
            const targetPath = resolvePath(relativePath);
            let fileContent = '';
            let originalContent = '';
            let totalReplacements = 0;
            let modified = false;
            let fileError: string | undefined = undefined;
            try {
                const stats = await fs.stat(targetPath);
                if (!stats.isFile()) {
                    fileError = 'Path is not a file';
                    continue; // Skip to next path
                }
                originalContent = await fs.readFile(targetPath, 'utf-8');
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
                    await fs.writeFile(targetPath, fileContent, 'utf-8');
                }
            } catch (error: any) {
                 if (error.code === 'ENOENT') fileError = 'File not found';
                 else {
                    console.error(`[Filesystem MCP] Error processing file ${relativePath} for replace_content:`, error);
                    fileError = `Failed to process file: ${error.message}`;
                 }
            } finally {
                 fileProcessingResults.push({ file: relativePath.replace(/\\/g, '/'), replacements: totalReplacements, modified, error: fileError });
            }
        } // End loop through relativePaths
    } catch (error: any) {
        if (error instanceof McpError) throw error;
        console.error(`[Filesystem MCP] Error during replace_content:`, error);
        throw new McpError(ErrorCode.InternalError, `Failed during replace_content: ${error.message}`);
    }
    return {
        content: [{
            type: "text",
            text: JSON.stringify({ message: `Replace content operations completed on specified paths.`, results: fileProcessingResults }, null, 2)
        }]
    };
};

const handleChmodItems = async (args: any) => { // Renamed from handleChmod
    const relativePaths = args?.paths;
    const modeString = args?.mode;
    if (!Array.isArray(relativePaths) || relativePaths.length === 0 || !relativePaths.every(p => typeof p === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    if (typeof modeString !== 'string' || !/^[0-7]{3,4}$/.test(modeString)) throw new McpError(ErrorCode.InvalidParams, 'Invalid required parameter: mode (must be an octal string like \'755\')');
    const mode = parseInt(modeString, 8);
    const results = await Promise.allSettled(relativePaths.map(async (relativePath) => {
        const targetPath = resolvePath(relativePath);
        if (targetPath === PROJECT_ROOT) return { path: relativePath, success: false, error: 'Changing permissions of the project root is not allowed.' };
        try {
            await fs.chmod(targetPath, mode);
            return { path: relativePath, success: true, mode: modeString };
        } catch (error: any) {
            if (error.code === 'ENOENT') return { path: relativePath, success: false, error: 'Path not found' };
            if (error instanceof McpError) return { path: relativePath, success: false, error: error.message };
            console.error(`[Filesystem MCP] Error changing mode for ${targetPath}:`, error);
            return { path: relativePath, success: false, error: `Failed to change mode: ${error.message}` };
        }
    }));
    const outputResults = results.map(result => result.status === 'fulfilled' ? result.value : { path: 'unknown', success: false, error: 'Unexpected error during processing.' });
    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};

// Placeholder for the new chown_items handler
const handleChownItems = async (args: any) => {
    const relativePaths = args?.paths;
    const uid = args?.uid;
    const gid = args?.gid;
    if (!Array.isArray(relativePaths) || relativePaths.length === 0 || !relativePaths.every(p => typeof p === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    if (typeof uid !== 'number') throw new McpError(ErrorCode.InvalidParams, 'Invalid or missing required parameter: uid (must be a number)');
    if (typeof gid !== 'number') throw new McpError(ErrorCode.InvalidParams, 'Invalid or missing required parameter: gid (must be a number)');

    // Note: fs.chown might not work reliably or as expected on Windows.
    // It might require administrator privileges or specific system configurations.
    const results = await Promise.allSettled(relativePaths.map(async (relativePath) => {
        const targetPath = resolvePath(relativePath);
        if (targetPath === PROJECT_ROOT) return { path: relativePath, success: false, error: 'Changing ownership of the project root is not allowed.' };
        try {
            await fs.chown(targetPath, uid, gid);
            return { path: relativePath, success: true, uid, gid };
        } catch (error: any) {
            if (error.code === 'ENOENT') return { path: relativePath, success: false, error: 'Path not found' };
            if (error.code === 'EPERM') return { path: relativePath, success: false, error: 'Operation not permitted (Permissions or unsupported on OS)' };
            if (error instanceof McpError) return { path: relativePath, success: false, error: error.message };
            console.error(`[Filesystem MCP] Error changing ownership for ${targetPath}:`, error);
            return { path: relativePath, success: false, error: `Failed to change ownership: ${error.message}` };
        }
    }));
    const outputResults = results.map(result => result.status === 'fulfilled' ? result.value : { path: 'unknown', success: false, error: 'Unexpected error during processing.' });
    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};

const handleMoveItems = async (args: any) => { // Renamed from handleMoveItem
    const operations = args?.operations;
    if (!Array.isArray(operations) || operations.length === 0 || !operations.every((op: any) => typeof op === 'object' && typeof op.source === 'string' && typeof op.destination === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: operations (must be a non-empty array of {source: string, destination: string} objects)');
    const results = await Promise.allSettled(operations.map(async (op) => {
        const sourceRelative = op.source;
        const destinationRelative = op.destination;

        const sourceAbsolute = resolvePath(sourceRelative);
        const destinationAbsolute = resolvePath(destinationRelative);

        if (sourceAbsolute === PROJECT_ROOT) return { source: sourceRelative, destination: destinationRelative, success: false, error: 'Moving the project root is not allowed.' };
        // Allow moving *to* the root directory itself as a destination, but resolvePath prevents writing *directly* as root.
        // if (destinationAbsolute === PROJECT_ROOT) return { source: sourceRelative, destination: destinationRelative, success: false, error: 'Moving an item directly into the project root is not allowed.' };

        try {
            // Ensure parent directory of destination exists before moving
            const destDir = path.dirname(destinationAbsolute);
            await fs.mkdir(destDir, { recursive: true });

            // Now attempt the move/rename
            await fs.rename(sourceAbsolute, destinationAbsolute);
            return { source: sourceRelative, destination: destinationRelative, success: true };
        } catch (error: any) {
            if (error.code === 'ENOENT') return { source: sourceRelative, destination: destinationRelative, success: false, error: `Source path not found: ${sourceRelative}` };
            if (error.code === 'EPERM' || error.code === 'EACCES') return { source: sourceRelative, destination: destinationRelative, success: false, error: `Permission denied moving '${sourceRelative}' to '${destinationRelative}'.` };
            // TODO: Consider handling EXDEV (cross-device link) by copying and deleting if needed
            if (error instanceof McpError) return { source: sourceRelative, destination: destinationRelative, success: false, error: error.message };
            console.error(`[Filesystem MCP] Error moving item from ${sourceAbsolute} to ${destinationAbsolute}:`, error);
            return { source: sourceRelative, destination: destinationRelative, success: false, error: `Failed to move item: ${error.message}` };
        }
    }));
    const outputResults = results.map(result => result.status === 'fulfilled' ? result.value : { source: 'unknown', destination: 'unknown', success: false, error: 'Unexpected error during processing.' });
    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};

// Placeholder for the new copy_items handler
const handleCopyItems = async (args: any) => {
    const operations = args?.operations;
    if (!Array.isArray(operations) || operations.length === 0 || !operations.every((op: any) => typeof op === 'object' && typeof op.source === 'string' && typeof op.destination === 'string')) throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: operations (must be a non-empty array of {source: string, destination: string} objects)');

    const results = await Promise.allSettled(operations.map(async (op) => {
        const sourceRelative = op.source;
        const destinationRelative = op.destination;
        const sourceAbsolute = resolvePath(sourceRelative);
        const destinationAbsolute = resolvePath(destinationRelative);

        if (sourceAbsolute === PROJECT_ROOT) return { source: sourceRelative, destination: destinationRelative, success: false, error: 'Copying the project root is not allowed.' };

        try {
            // Ensure parent directory of destination exists
            const destDir = path.dirname(destinationAbsolute);
            await fs.mkdir(destDir, { recursive: true });

            // Perform the copy (recursive for directories)
            // fs.cp is available in Node 16.7+
            if (typeof fs.cp === 'function') {
                 await fs.cp(sourceAbsolute, destinationAbsolute, { recursive: true, errorOnExist: false, force: true }); // Overwrite if exists
            } else {
                 // Fallback for older Node versions (less robust, especially for directories)
                 // This basic fallback only copies files, not directories recursively.
                 // A more robust fallback would require a recursive copy implementation.
                 const stats = await fs.stat(sourceAbsolute);
                 if (stats.isDirectory()) {
                     return { source: sourceRelative, destination: destinationRelative, success: false, error: 'Recursive directory copy requires Node.js 16.7+ (fs.cp). Basic fallback cannot copy directories.' };
                 }
                 await fs.copyFile(sourceAbsolute, destinationAbsolute); // Default overwrites
            }

            return { source: sourceRelative, destination: destinationRelative, success: true };
        } catch (error: any) {
            if (error.code === 'ENOENT') return { source: sourceRelative, destination: destinationRelative, success: false, error: `Source path not found: ${sourceRelative}` };
            if (error.code === 'EPERM' || error.code === 'EACCES') return { source: sourceRelative, destination: destinationRelative, success: false, error: `Permission denied copying '${sourceRelative}' to '${destinationRelative}'.` };
            if (error instanceof McpError) return { source: sourceRelative, destination: destinationRelative, success: false, error: error.message };
            console.error(`[Filesystem MCP] Error copying item from ${sourceAbsolute} to ${destinationAbsolute}:`, error);
            return { source: sourceRelative, destination: destinationRelative, success: false, error: `Failed to copy item: ${error.message}` };
        }
    }));
    const outputResults = results.map(result => result.status === 'fulfilled' ? result.value : { source: 'unknown', destination: 'unknown', success: false, error: 'Unexpected error during processing.' });
    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};

// --- Server Setup ---

const server = new Server(
  {
    name: "filesystem-mcp",
    version: "0.2.0", // Updated version for refined toolset
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
  switch (request.params.name) {
    case listFilesTool.name: return handleListFiles(request.params.arguments);
    case statItemsTool.name: return handleStatItems(request.params.arguments); // New handler needed
    case readContentTool.name: return handleReadContent(request.params.arguments); // Rename handleReadMultipleFiles
    case writeContentTool.name: return handleWriteContent(request.params.arguments); // Rename handleWriteMultipleFiles + add append logic
    case deleteItemsTool.name: return handleDeleteItems(request.params.arguments); // Keep as is (already handles multiple)
    case createDirectoriesTool.name: return handleCreateDirectories(request.params.arguments); // Keep as is (already handles multiple)
    case chmodItemsTool.name: return handleChmodItems(request.params.arguments); // Rename handleChmod + adapt for multiple paths
    case chownItemsTool.name: return handleChownItems(request.params.arguments); // New handler needed
    case moveItemsTool.name: return handleMoveItems(request.params.arguments); // Rename handleMoveItem + adapt for multiple operations
    case copyItemsTool.name: return handleCopyItems(request.params.arguments); // New handler needed
    case searchFilesTool.name: return handleSearchFiles(request.params.arguments); // Keep as is
    case replaceContentTool.name: return handleReplaceContent(request.params.arguments); // Rename handleSearchAndReplaceMultipleFiles + adapt input
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
