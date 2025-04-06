import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolDefinition } from './index.js'; // Assuming ToolDefinition is defined/exported in index.js
import { resolvePath } from '../utils/pathUtils.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import detectIndent from 'detect-indent';
import { createPatch } from 'diff';

// --- Zod Schema Definition ---

const EditFileChangeSchema = z.object({
    path: z.string().min(1).describe('Relative path to the file to modify.'),
    search_pattern: z.string().optional().describe('Multi-line text or regex pattern to find the block to replace or delete. If empty or omitted, implies insertion at start_line.'),
    start_line: z.number().int().min(1).describe('The 1-based line number where the search_pattern is expected to start, or where insertion should occur.'),
    replace_content: z.string().optional().describe('The content to replace the matched block with. If omitted and search_pattern is present, it deletes the matched block. Required for insertion.'),
    use_regex: z.boolean().default(false).describe('Treat search_pattern as a regular expression.'),
    ignore_leading_whitespace: z.boolean().default(true).describe('Ignore leading whitespace on each line of search_pattern when matching plain text.'),
    preserve_indentation: z.boolean().default(true).describe('Attempt to automatically adjust the indentation of replace_content to match the context of the replaced/inserted block.'),
    match_occurrence: z.number().int().min(1).default(1).describe('Specifies which occurrence of the search_pattern (relative to start_line if provided, or globally otherwise) to target (1-based). Default is 1.'),
}).refine(data => data.search_pattern !== undefined || data.replace_content !== undefined, {
    message: "Either 'search_pattern' or 'replace_content' must be provided for a change operation.",
});

const EditFileArgsSchema = z.object({
    changes: z.array(EditFileChangeSchema).min(1).describe('List of changes to apply across one or more files.'),
    dry_run: z.boolean().default(false).describe('If true, perform matching and generate diffs but do not write any changes to disk.'),
    output_diff: z.boolean().default(true).describe('Whether to include a unified diff string in the result for each modified file.'),
});

// Infer the type from the Zod schema
type EditFileArgs = z.infer<typeof EditFileArgsSchema>;
type EditFileChange = z.infer<typeof EditFileChangeSchema>; // Keep this if used internally

// --- Result Interfaces ---

export interface EditFileResultItem {
    path: string;
    status: 'success' | 'failed' | 'skipped';
    message?: string; // Error message if failed/skipped
    diff?: string; // Unified diff if output_diff is true and changes were made
}

export interface EditFileResult {
    results: EditFileResultItem[];
}

// --- Helper: Get Indentation ---
function getIndentation(line: string | undefined): string {
    if (!line) return '';
    const match = line.match(/^\s*/);
    return match ? match[0] : '';
}

// --- Helper: Apply Indentation ---
function applyIndentation(content: string, indent: string): string[] {
    return content.split('\n').map(line => indent + line);
}


// --- Handler Function ---

// Define the expected MCP response structure type
type McpToolResponse = { content: Array<{ type: 'text', text: string }> };

async function handleEditFile(rawArgs: unknown): Promise<McpToolResponse> {
    // Validate input using the Zod schema
    const validationResult = EditFileArgsSchema.safeParse(rawArgs);
    if (!validationResult.success) {
        const errorDetails = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for editFile: ${errorDetails}`);
    }
    const args: EditFileArgs = validationResult.data;

    const results: EditFileResultItem[] = [];
    const { changes, dry_run = false, output_diff = true } = args;

    const changesByFile = changes.reduce((acc, change) => {
        if (!acc[change.path]) {
            acc[change.path] = [];
        }
        acc[change.path].push(change);
        return acc;
    }, {} as Record<string, EditFileChange[]>);

    for (const relativePath in changesByFile) {
        let absolutePath: string;
        let originalContent: string | null = null;
        let currentContent: string | null = null;
        let fileResult: EditFileResultItem = { path: relativePath, status: 'skipped' };
        let fileProcessed = false;
        let changesAppliedToFile = false;

        try {
            absolutePath = resolvePath(relativePath);

            try {
                originalContent = await fs.readFile(absolutePath, 'utf-8');
                currentContent = originalContent;
            } catch (readError: any) {
                if (readError.code === 'ENOENT') {
                     throw new McpError(ErrorCode.InvalidRequest, `File not found: ${relativePath}`);
                }
                throw readError;
            }

            const fileChanges = changesByFile[relativePath];
            // Sort changes by start_line descending
            fileChanges.sort((a, b) => b.start_line - a.start_line);

            for (const change of fileChanges) {
                fileProcessed = true;
                let changeSucceeded = false;
                // IMPORTANT: Recalculate lines based on potentially modified currentContent at the start of each change iteration
                let lines: string[] = (currentContent ?? '').split('\n'); // Add explicit type annotation

                const {
                    search_pattern,
                    start_line,
                    replace_content,
                    use_regex = false,
                    ignore_leading_whitespace = true,
                    preserve_indentation = true,
                    match_occurrence = 1
                } = change;

                const targetLineIndex = start_line - 1;

                if (targetLineIndex < 0) {
                     console.warn(`[editFile] Invalid start_line ${start_line} for change in ${relativePath}. Skipping change.`);
                     continue;
                }

                // --- Insertion Logic ---
                if (!search_pattern && replace_content !== undefined) {
                    if (targetLineIndex > lines.length) {
                         console.warn(`[editFile] start_line ${start_line} is beyond the end of file ${relativePath} for insertion. Appending instead.`);
                    }
                    const effectiveInsertionLine = Math.min(targetLineIndex, lines.length);
                    let indent = '';
                    if (preserve_indentation && effectiveInsertionLine > 0 && effectiveInsertionLine <= lines.length) {
                         indent = getIndentation(lines[effectiveInsertionLine - 1]);
                    }
                    const replacementLines = applyIndentation(replace_content, indent);
                    lines.splice(effectiveInsertionLine, 0, ...replacementLines);
                    // Update currentContent immediately after modifying lines
                    currentContent = lines.join('\n');
                    changeSucceeded = true;
                }
                // --- Search/Replace/Delete Logic ---
                else if (search_pattern) {
                    if (use_regex) {
                        // --- Regex Matching ---
                        let regex: RegExp;
                        try {
                            regex = new RegExp(search_pattern, 'g');
                        } catch (e: any) {
                             fileResult.status = 'failed';
                             fileResult.message = `Invalid regex pattern "${search_pattern}" in ${relativePath}: ${e.message}`;
                             console.error(`[editFile] ${fileResult.message}`);
                             continue; // Skip this change if regex is invalid
                        }
                        let occurrencesFound = 0;
                        let match: RegExpExecArray | null;
                        let matchStartIndex = -1;
                        let matchEndIndex = -1;

                        // Search within the *current* content state
                        const contentToSearch = currentContent as string;
                        regex.lastIndex = 0; // Reset before searching

                        for (let k = 0; k < match_occurrence; k++) {
                            match = regex.exec(contentToSearch);
                            if (match === null) {
                                matchStartIndex = -1;
                                break;
                            }
                            matchStartIndex = match.index;
                            matchEndIndex = match.index + match[0].length;
                            occurrencesFound++;
                            if (match.index === regex.lastIndex) {
                                 regex.lastIndex++;
                            }
                            if (k === match_occurrence - 1) break;
                        }
                        if (occurrencesFound < match_occurrence) {
                            matchStartIndex = -1;
                        }

                        if (matchStartIndex !== -1 && currentContent !== null) {
                            let indent = '';
                            if (preserve_indentation) {
                                // Determine indent based on the line where the match starts in the *current* content
                                const contentUpToMatch = currentContent.substring(0, matchStartIndex);
                                const linesUpToMatch = contentUpToMatch.split('\n');
                                const lineIndexContainingMatch = linesUpToMatch.length - 1;
                                if (lineIndexContainingMatch >= 0 && lineIndexContainingMatch < lines.length) {
                                     indent = getIndentation(lines[lineIndexContainingMatch]);
                                }
                            }

                            if (replace_content !== undefined) {
                                const replacementLines = applyIndentation(replace_content, indent);
                                const indentedReplacement = replacementLines.join('\n');
                                currentContent = currentContent.slice(0, matchStartIndex) + indentedReplacement + currentContent.slice(matchEndIndex);
                                changeSucceeded = true;
                            } else {
                                currentContent = currentContent.slice(0, matchStartIndex) + currentContent.slice(matchEndIndex);
                                changeSucceeded = true;
                            }
                        } else {
                             console.warn(`[editFile] Regex pattern "${search_pattern}" not found (occurrence ${match_occurrence}) starting near line ${start_line} in ${relativePath}. Skipping change.`);
                             changeSucceeded = false;
                        }
                    }
                    // --- Plain Text Matching ---
                    else {
                        const searchLines = search_pattern.split('\n');
                        let occurrencesFound = 0;
                        let matchStartIndex = -1;
                        let matchEndIndex = -1;
                        const searchStartLine = Math.min(targetLineIndex, lines.length -1);

                        for (let i = searchStartLine; i <= lines.length - searchLines.length; i++) {
                            if (i < 0) continue;
                            let isMatch = true;
                            for (let j = 0; j < searchLines.length; j++) {
                                let fileLine = lines[i + j];
                                let searchLine = searchLines[j];
                                if (ignore_leading_whitespace) {
                                    if (searchLine.trim().length > 0) {
                                        fileLine = fileLine.trimStart();
                                    }
                                    searchLine = searchLine.trimStart();
                                }
                                if (fileLine !== searchLine) {
                                    isMatch = false;
                                    break;
                                }
                            }
                            if (isMatch) {
                                occurrencesFound++;
                                if (occurrencesFound === match_occurrence) {
                                    matchStartIndex = i;
                                    matchEndIndex = i + searchLines.length;
                                    break;
                                }
                            }
                        }

                        if (matchStartIndex !== -1) {
                            let indent = '';
                            if (preserve_indentation && matchStartIndex < lines.length) {
                                 indent = getIndentation(lines[matchStartIndex]);
                            }
                            if (replace_content !== undefined) {
                                const replacementLines = applyIndentation(replace_content, indent);
                                lines.splice(matchStartIndex, matchEndIndex - matchStartIndex, ...replacementLines);
                                // Update currentContent immediately after modifying lines
                                currentContent = lines.join('\n');
                                changeSucceeded = true;
                            } else {
                                lines.splice(matchStartIndex, matchEndIndex - matchStartIndex);
                                // Update currentContent immediately after modifying lines
                                currentContent = lines.join('\n');
                                changeSucceeded = true;
                            }
                        } else {
                             console.warn(`[editFile] Search pattern not found (occurrence ${match_occurrence}) starting near line ${start_line} in ${relativePath}. Skipping change.`);
                             changeSucceeded = false;
                        }
                    } // End Plain Text Matching else block
                } // End Search/Replace/Delete Logic (else if search_pattern)

                // Update overall flag if this change succeeded
                if (changeSucceeded) {
                    changesAppliedToFile = true;
                    // No need to explicitly sync lines/currentContent here anymore,
                    // as lines is recalculated at the start of the loop,
                    // and currentContent is updated directly within the modification logic.
                }

            } // End loop through changes for this file

            // --- Finalize File Processing ---
            if (changesAppliedToFile && currentContent !== null && originalContent !== null) {
                // Check if content actually changed before setting success
                if (currentContent !== originalContent) {
                    fileResult.status = 'success';
                    if (output_diff) {
                        fileResult.diff = createPatch(
                            relativePath, originalContent, currentContent, '', '', { context: 3 }
                        );
                    }
                    if (!dry_run) {
                        await fs.writeFile(absolutePath, currentContent, 'utf-8');
                        fileResult.message = `File ${relativePath} modified successfully.`;
                    } else {
                        fileResult.message = `File ${relativePath} changes calculated (dry run).`;
                    }
                } else {
                    // Changes were applied, but resulted in the original content (e.g., replacing 'a' with 'a')
                    fileResult.status = 'skipped'; // Or 'success' with a specific message? Skipped seems clearer.
                    fileResult.message = `Changes applied to ${relativePath} resulted in no net change to content.`;
                }
            } else if (fileProcessed && !changesAppliedToFile && fileResult.status !== 'failed') {
                 fileResult.status = 'skipped';
                 fileResult.message = `No applicable changes found or made for ${relativePath}.`;
            }

        } catch (error: any) { // CATCH BLOCK FOR THE MAIN FILE PROCESSING TRY
            console.error(`[editFile] Error processing ${relativePath}:`, error);
            if (fileResult.status !== 'failed' || !fileResult.message) {
                fileResult.status = 'failed';
                if (error instanceof McpError) {
                    fileResult.message = error.message;
                } else if (error.code) {
                    fileResult.message = `Filesystem error (${error.code}) processing ${relativePath}.`;
                } else {
                    fileResult.message = `Unexpected error processing ${relativePath}: ${error.message || error}`;
                }
            }
        } finally { // FINALLY BLOCK FOR THE MAIN FILE PROCESSING TRY
            results.push(fileResult);
        }
    } // End loop through files

    return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
} // END OF handleEditFile FUNCTION

// --- Tool Definition Export ---

export const editFileDefinition: ToolDefinition = {
    name: 'edit_file',
    description: 'Make selective edits to one or more files using advanced pattern matching and formatting options. Supports insertion, deletion, and replacement with indentation preservation and diff output. Recommended for modifying existing files, especially for complex changes or when precise control is needed.',
    schema: EditFileArgsSchema,
    handler: handleEditFile,
};