import { promises as fs } from "fs";
import { z } from 'zod';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath } from '../utils/pathUtils.js';

/**
 * Handles the 'replace_content' MCP tool request.
 * Replaces content within files across multiple specified paths.
 */

// Define Zod schema for individual replace operations
const ReplaceOperationSchema = z.object({
  search: z.string(), // Cannot be empty, but Zod defaults handle this if needed
  replace: z.string(),
  use_regex: z.boolean().optional().default(false),
  ignore_case: z.boolean().optional().default(false),
}).strict();

// Define Zod schema for the main arguments object
const ReplaceContentArgsSchema = z.object({
  paths: z.array(z.string()).min(1, { message: "Paths array cannot be empty" }),
  operations: z.array(ReplaceOperationSchema).min(1, { message: "Operations array cannot be empty" }),
}).strict();

// Infer TypeScript type from schema
type ReplaceContentArgs = z.infer<typeof ReplaceContentArgsSchema>;

export const handleReplaceContent = async (args: unknown) => {
    // Validate and parse arguments
    let parsedArgs: ReplaceContentArgs;
    try {
        parsedArgs = ReplaceContentArgsSchema.parse(args);
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${error.errors.map(e => `${e.path.join('.')} (${e.message})`).join(', ')}`);
        }
        throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
    }
    const { paths: relativePaths, operations } = parsedArgs;

    // Define result structure
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
    fileProcessingResults.sort((a, b) => relativePaths.indexOf(a.file ?? '') - relativePaths.indexOf(b.file ?? '')); // Handle potential undefined path

    return {
        content: [{
            type: "text",
            text: JSON.stringify({ message: `Replace content operations completed on specified paths.`, results: fileProcessingResults }, null, 2)
        }]
    };
};