import { promises as fs } from "fs";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath } from '../utils/pathUtils.js'; // Use .js extension

/**
 * Handles the 'replace_content' MCP tool request.
 * Replaces content within files across multiple specified paths.
 */
export const handleReplaceContent = async (args: any) => {
    const relativePaths = args?.paths;
    const operations = args?.operations;

    if (!Array.isArray(relativePaths) || relativePaths.length === 0 || !relativePaths.every(p => typeof p === 'string')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    }
    if (!Array.isArray(operations) || operations.length === 0 || !operations.every((op: any) => typeof op === 'object' && typeof op.search === 'string' && typeof op.replace === 'string')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: operations (must be a non-empty array of {search: string, replace: string, use_regex?: boolean, ignore_case?: boolean} objects)');
    }

    // Define result structure
    type ReplaceResult = {
        file: string;
        replacements: number;
        modified: boolean;
        error?: string;
    };
    const fileProcessingResults: ReplaceResult[] = [];

    try {
        for (const relativePath of relativePaths) {
            const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
            let targetPath: string = ''; // Initialize for use in finally block
            let fileContent = '';
            let originalContent = '';
            let totalReplacements = 0;
            let modified = false;
            let fileError: string | undefined = undefined;

            try {
                targetPath = resolvePath(relativePath);
                const stats = await fs.stat(targetPath);
                if (!stats.isFile()) {
                    fileError = 'Path is not a file';
                    continue; // Skip to next path in outer loop
                }
                originalContent = await fs.readFile(targetPath, 'utf-8');
                fileContent = originalContent;

                for (const op of operations) {
                    let replacementsInOp = 0;
                    const searchPattern = op.search;
                    const replacementText = op.replace;
                    const useRegex = op.use_regex ?? false;
                    const ignoreCase = op.ignore_case ?? false;

                    let regexFlags = 'g'; // Always global replace within a file
                    if (ignoreCase) regexFlags += 'i';

                    const searchRegex = useRegex
                        ? new RegExp(searchPattern, regexFlags)
                        : new RegExp(searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), regexFlags); // Escape non-regex search string

                    // Count matches before replacing
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
                 if (error.code === 'ENOENT') {
                     fileError = 'File not found';
                 } else if (error instanceof McpError) {
                     fileError = error.message; // Propagate McpError message
                 } else {
                    console.error(`[Filesystem MCP - replaceContent] Error processing file ${relativePath}:`, error);
                    fileError = `Failed to process file: ${error.message}`;
                 }
            } finally {
                 // Ensure a result is always pushed for each path attempted
                 fileProcessingResults.push({ file: pathOutput, replacements: totalReplacements, modified, error: fileError });
            }
        } // End loop through relativePaths
    } catch (error: any) {
        // Catch errors during the overall process (e.g., initial validation)
        if (error instanceof McpError) throw error;
        console.error(`[Filesystem MCP - replaceContent] Error during replace_content execution:`, error);
        throw new McpError(ErrorCode.InternalError, `Failed during replace_content: ${error.message}`);
    }

    // Sort results by original path order for predictability
    fileProcessingResults.sort((a, b) => relativePaths.indexOf(a.file) - relativePaths.indexOf(b.file));

    return {
        content: [{
            type: "text",
            text: JSON.stringify({ message: `Replace content operations completed on specified paths.`, results: fileProcessingResults }, null, 2)
        }]
    };
};