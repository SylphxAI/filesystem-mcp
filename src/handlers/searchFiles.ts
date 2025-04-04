import { promises as fs } from "fs";
import path from "path";
import { z } from 'zod';
import { glob } from 'glob';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';

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

const handleSearchFilesFunc = async (args: unknown) => {
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
        const flagsMatch = regexString.match(/\/([gimyus]+)$/);
        const flags = flagsMatch ? flagsMatch[1] : '';
        const pattern = flagsMatch ? regexString.slice(1, flagsMatch.index) : regexString;
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
        targetPath = resolvePath(relativePath);
        // Use targetPath as cwd for glob
        const globPattern = filePattern; // Pattern is now relative to cwd
        const ignorePattern = path.join(targetPath, '**/node_modules/**').replace(/\\/g, '/'); // Still need absolute ignore path
        const files = await glob(globPattern, {
            cwd: targetPath,
            nodir: true,
            dot: true,
            ignore: [ignorePattern],
            absolute: true // Get absolute paths back for reading
        });

        for (const absoluteFilePath of files) {
            const fileRelative = path.relative(PROJECT_ROOT, absoluteFilePath).replace(/\\/g, '/');
            try {
                const fileContent = await fs.readFile(absoluteFilePath, 'utf-8');
                const lines = fileContent.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    let matchResult;
                    // Reset lastIndex for global regex on each new line
                    if (searchRegex.global) searchRegex.lastIndex = 0;

                    while ((matchResult = searchRegex.exec(line)) !== null) {
                        const match = matchResult[0];
                        const startContext = Math.max(0, i - CONTEXT_LINES);
                        const endContext = Math.min(lines.length, i + CONTEXT_LINES + 1);
                        const context = lines.slice(startContext, endContext);
                        results.push({ file: fileRelative, line: i + 1, match: match, context: context });

                        // If regex is not global, break after the first match on the line
                        if (!searchRegex.global) break;
                        // Prevent infinite loops with zero-width matches in global regex
                        if (matchResult.index === searchRegex.lastIndex) {
                            searchRegex.lastIndex++;
                        }
                    }
                }
            } catch (readError: any) {
                // Ignore errors reading specific files (e.g., permission denied, binary files)
                if (readError.code !== 'ENOENT') { // Don't warn if file disappeared between glob and read
                    console.warn(`[Filesystem MCP - searchFiles] Could not read or process file ${fileRelative} during search: ${readError.message}`);
                }
            }
        }
    } catch (error: any) {
        if (error instanceof McpError) throw error; // Re-throw specific McpErrors
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
    handler: handleSearchFilesFunc,
};