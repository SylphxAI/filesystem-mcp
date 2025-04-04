import { promises as fs } from "fs";
import path from "path";
import { glob } from 'glob';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js'; // Use .js extension

/**
 * Handles the 'search_files' MCP tool request.
 * Searches for a regex pattern within files in a specified directory.
 */
export const handleSearchFiles = async (args: any) => {
    const relativePath = args?.path ?? ".";
    const regexString = args?.regex;
    const filePattern = args?.file_pattern ?? "*";

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