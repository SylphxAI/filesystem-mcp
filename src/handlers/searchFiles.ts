import { promises as fsPromises, PathLike } from "fs"; // Import PathLike
import path from "path";
import { z } from 'zod';
import { glob as globFn, GlobOptions } from 'glob'; // Import types from glob
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath as resolvePathUtil, PROJECT_ROOT as projectRootUtil } from '../utils/pathUtils.js';

/**
 * Handles the 'search_files' MCP tool request.
 * Searches for a regex pattern within files in a specified directory.
 */

// Define Zod schema and export it
export const SearchFilesArgsSchema = z.object({
  path: z.string().optional().default(".").describe("Relative path of the directory to search in."),
  regex: z.string().min(1, { message: "Regex pattern cannot be empty" }).describe("The regex pattern to search for."),
  file_pattern: z.string().optional().default("*").describe("Glob pattern to filter files (e.g., '*.ts'). Defaults to all files ('*')."),
}).strict();

// Infer TypeScript type
type SearchFilesArgs = z.infer<typeof SearchFilesArgsSchema>;

// Removed duplicated non-exported schema/type definitions

// Define Dependencies Interface
export interface SearchFilesDependencies {
    readFile: (p: PathLike, options: any) => Promise<string>; // Simplified options
    glob: typeof globFn; // Use the type of the imported glob function
    resolvePath: typeof resolvePathUtil;
    PROJECT_ROOT: string;
    path: Pick<typeof path, 'relative' | 'join'>; // Only relative and join used
}

export const handleSearchFilesFunc = async (deps: SearchFilesDependencies, args: unknown) => {
    // Validate and parse arguments
    let parsedArgs: SearchFilesArgs;
    try {
        parsedArgs = SearchFilesArgsSchema.parse(args);
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${error.errors.map(e => `${e.path.join('.')} (${e.message})`).join(', ')}`);
        }
        throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
    }
    const { path: relativePath, regex: regexString, file_pattern: filePattern } = parsedArgs;

    if (typeof regexString !== 'string' || regexString.trim() === '') {
        throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: regex');
    }

    let searchRegex: RegExp;
    try {
        // Basic check for flags, assuming standard JS flags if present after last /
        // Always add 'g' flag for searching, keep other user-provided flags if any
        const flagsMatch = regexString.match(/\/([gimyus]+)$/);
        let flags = flagsMatch ? flagsMatch[1] : '';
        const pattern = flagsMatch ? regexString.slice(1, flagsMatch.index) : regexString;
        if (!flags.includes('g')) {
            flags += 'g'; // Ensure global flag is always present
        }
        searchRegex = new RegExp(pattern, flags);
    } catch (error: any) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid regex pattern: ${error.message}`);
    }

    // Define result structure
    type SearchResult = {
        file: string;
        line: number;
        match: string;
        context: string[];
    };
    const results: SearchResult[] = [];
    const CONTEXT_LINES = 2; // Number of lines before and after the match to include

    let targetPath: string = ''; // Initialize for use in catch block
    try {
        targetPath = deps.resolvePath(relativePath);
        // Use targetPath as cwd for glob
        const globPattern = filePattern; // Pattern is now relative to cwd
        const ignorePattern = deps.path.join(targetPath, '**/node_modules/**').replace(/\\/g, '/'); // Still need absolute ignore path
        const files = await deps.glob(globPattern, {
            cwd: targetPath,
            nodir: true,
            dot: true,
            ignore: [ignorePattern],
            absolute: true // Get absolute paths back for reading
        });

        for (const absoluteFilePath of files) {
            const fileRelative = deps.path.relative(deps.PROJECT_ROOT, absoluteFilePath).replace(/\\/g, '/');
            try {
                const fileContent = await deps.readFile(absoluteFilePath, 'utf-8');
                const lines = fileContent.split('\n');

                // Execute regex on the entire file content for multi-line support
                // let matchResult; // Remove duplicate declaration
                if (searchRegex.global) searchRegex.lastIndex = 0; // Reset for global search

                // Execute regex on the entire file content for multi-line support
                let matchResult;
                if (searchRegex.global) searchRegex.lastIndex = 0; // Reset for global search

                while ((matchResult = searchRegex.exec(fileContent)) !== null) {
                    const match = matchResult[0];
                    const matchStartIndex = matchResult.index;
                    // console.log(`[DEBUG searchFiles] Match found: "${match}", index: ${matchStartIndex}, lastIndex before: ${searchRegex.lastIndex}`); // REMOVE DEBUG

                    // Determine the line number of the match start
                    const contentUpToMatch = fileContent.substring(0, matchStartIndex);
                    const lineNumber = (contentUpToMatch.match(/\n/g) || []).length + 1; // 1-based line number

                    // Determine context lines
                    const startContextLineIndex = Math.max(0, lineNumber - 1 - CONTEXT_LINES);
                    const endContextLineIndex = Math.min(lines.length, lineNumber + CONTEXT_LINES); // Use lines.length here
                    const context = lines.slice(startContextLineIndex, endContextLineIndex);

                    results.push({ file: fileRelative, line: lineNumber, match: match, context: context });

                    // If regex is not global, break after the first match
                    if (!searchRegex.global) {
                         // console.log("[DEBUG searchFiles] Regex not global, breaking loop."); // REMOVE DEBUG
                         break;
                    }
                    // Prevent infinite loops with zero-width matches in global regex
                    // AND ensure loop continues for global regex even if match is found
                    if (matchResult.index === searchRegex.lastIndex) {
                        // console.log("[DEBUG searchFiles] Zero-width match detected, incrementing lastIndex."); // REMOVE DEBUG
                        searchRegex.lastIndex++;
                    }
                     // console.log(`[DEBUG searchFiles] Match processed, lastIndex after: ${searchRegex.lastIndex}`); // REMOVE DEBUG
                }
            } catch (readError: any) {
                // Ignore errors reading specific files (e.g., permission denied, binary files)
                if (readError.code !== 'ENOENT') { // Don't warn if file disappeared between glob and read
                    console.warn(`[Filesystem MCP - searchFiles] Could not read or process file ${fileRelative} during search: ${readError.message}`);
                }
            }
        }
    } catch (error: any) {
        if (error instanceof McpError) throw error; // Re-throw specific McpErrors from resolvePath
        console.error(`[Filesystem MCP - searchFiles] Error searching files in ${relativePath} (resolved: ${targetPath}):`, error);
        throw new McpError(ErrorCode.InternalError, `Failed to search files: ${error.message}`);
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
};

// Export the complete tool definition
export const searchFilesToolDefinition = {
    name: "search_files",
    description: "Search for a regex pattern within files in a specified directory (read-only).",
    schema: SearchFilesArgsSchema,
    // The production handler needs to provide the dependencies
    handler: (args: unknown) => {
        const deps: SearchFilesDependencies = {
            readFile: fsPromises.readFile,
            glob: globFn,
            resolvePath: resolvePathUtil,
            PROJECT_ROOT: projectRootUtil,
            path: { relative: path.relative, join: path.join },
        };
        return handleSearchFilesFunc(deps, args);
    },
};