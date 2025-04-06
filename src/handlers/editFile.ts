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
// Removed stray closing brace

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

// Remove the manually defined interfaces as they are now inferred from Zod schemas

// Define the expected MCP response structure type
type McpToolResponse = { content: Array<{ type: 'text', text: string }> };

async function handleEditFile(rawArgs: unknown): Promise<McpToolResponse> {
    // Validate input using the Zod schema
    const validationResult = EditFileArgsSchema.safeParse(rawArgs);
    if (!validationResult.success) {
        // Format Zod errors into a user-friendly message or structure
        const errorDetails = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for editFile: ${errorDetails}`);
    }
    const args: EditFileArgs = validationResult.data; // Use validated and typed data

    const results: EditFileResultItem[] = [];
    const { changes, dry_run = false, output_diff = true } = args;

    // Group changes by file path to process each file only once
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
        let fileResult: EditFileResultItem = { path: relativePath, status: 'skipped' }; // Default to skipped
        let fileProcessed = false; // Track if any change was attempted for this file

        try {
            absolutePath = resolvePath(relativePath);

            // Read the original file content
            try {
                originalContent = await fs.readFile(absolutePath, 'utf-8');
                currentContent = originalContent; // Start with original content
            } catch (readError: any) {
                if (readError.code === 'ENOENT') {
                     throw new McpError(ErrorCode.InvalidRequest, `File not found: ${relativePath}`);
                }
                throw readError; // Re-throw other read errors
            }

            const fileChanges = changesByFile[relativePath];
            let changesAppliedToFile = false; // Track if any change *succeeded* for this file
            let lines = currentContent.split('\n'); // Work with lines array

            // Sort changes by start_line descending to handle edits from bottom-up,
            // minimizing line number shifts affecting subsequent edits in the same pass.
            fileChanges.sort((a, b) => b.start_line - a.start_line);

            for (const change of fileChanges) {
                fileProcessed = true; // Mark that we attempted processing for this file
                let changeSucceeded = false;
                const {
                    search_pattern,
                    start_line,
                    replace_content,
                    use_regex = false,
                    ignore_leading_whitespace = true,
                    preserve_indentation = true,
                    match_occurrence = 1
                } = change;

                const targetLineIndex = start_line - 1; // 0-based index

                if (targetLineIndex < 0) {
                     console.warn(`[editFile] Invalid start_line ${start_line} for change in ${relativePath}. Skipping change.`);
                     continue; // Skip this specific change
                }

                // --- Insertion Logic ---
                if (!search_pattern && replace_content !== undefined) {
                    if (targetLineIndex > lines.length) {
                         console.warn(`[editFile] start_line ${start_line} is beyond the end of file ${relativePath} for insertion. Appending instead.`);
                         // Adjust targetLineIndex if needed, or handle as error? For now, append.
                    }
                    const effectiveInsertionLine = Math.min(targetLineIndex, lines.length);

                    let indent = '';
                    if (preserve_indentation) {
                        // Try to get indent from the line *before* insertion, or file default
                        if (effectiveInsertionLine > 0) {
                            indent = getIndentation(lines[effectiveInsertionLine - 1]);
                        } else if (lines.length > 0) {
                            // If inserting at the very beginning, try to detect file indent
                            indent = detectIndent(currentContent || '').indent || '';
                        }
                    }

                    const replacementLines = applyIndentation(replace_content, indent);
                    lines.splice(effectiveInsertionLine, 0, ...replacementLines);
                    changeSucceeded = true;
                }
                // --- Search/Replace/Delete Logic ---
                else if (search_pattern) {
                    if (use_regex) {
                        // --- Regex Matching ---
                        let regex: RegExp;
                        try {
                            // Basic regex creation, consider adding flags from schema later (e.g., 'gm', 'gmi')
                            regex = new RegExp(search_pattern, 'g'); // Use 'g' to find all occurrences
                        } catch (e: any) {
                             // Set failure status for this specific change attempt due to invalid regex
                             fileResult.status = 'failed'; // Mark the file processing as failed overall
                             fileResult.message = `Invalid regex pattern "${search_pattern}" in ${relativePath}: ${e.message}`;
                             console.error(`[editFile] ${fileResult.message}`); // Log as error
                             // Skip further processing for *this specific change* as the regex is invalid
                             continue;
                        }
                        let occurrencesFound = 0;
                        let match: RegExpExecArray | null;
                        let matchStartIndex = -1;
                        let matchEndIndex = -1;
                        let lastIndex = 0; // To avoid infinite loops with zero-width matches

                        // Reset lastIndex before searching
                        regex.lastIndex = 0;

                        // Find the Nth occurrence
                        while ((match = regex.exec(currentContent as string)) !== null) {
                             // Prevent infinite loops with zero-width matches
                             if (match.index === regex.lastIndex) {
                                 regex.lastIndex++;
                             }

                             occurrencesFound++;
                             if (occurrencesFound === match_occurrence) {
                                 matchStartIndex = match.index;
                                 matchEndIndex = match.index + match[0].length;
                                 break; // Found the desired occurrence
                             }
                             lastIndex = regex.lastIndex; // Store last index for next iteration
                        }


                        if (matchStartIndex !== -1) {
                            // Match found!
                            let indent = '';
                            if (preserve_indentation) {
                                // Find the line containing the start of the match
                                const contentUpToMatch = (currentContent as string).substring(0, matchStartIndex);
                                const linesUpToMatch = contentUpToMatch.split('\n');
                                const lineIndexContainingMatch = linesUpToMatch.length - 1;
                                if (lineIndexContainingMatch >= 0 && lineIndexContainingMatch < lines.length) {
                                     indent = getIndentation(lines[lineIndexContainingMatch]);
                                }
                            }

                            if (replace_content !== undefined) {
                                // --- Replace ---
                                const replacementLines = applyIndentation(replace_content, indent);
                                const indentedReplacement = replacementLines.join('\n');
                                currentContent = (currentContent as string).slice(0, matchStartIndex) + indentedReplacement + (currentContent as string).slice(matchEndIndex);
                                changeSucceeded = true;
                            } else {
                                // --- Delete ---
                                currentContent = (currentContent as string).slice(0, matchStartIndex) + (currentContent as string).slice(matchEndIndex);
                                changeSucceeded = true;
                            }
                        } else {
                             console.warn(`[editFile] Regex pattern "${search_pattern}" not found (occurrence ${match_occurrence}) starting near line ${start_line} in ${relativePath}. Skipping change.`);
                        }
                        // DO NOT continue here; let it fall through to the update logic below
                    }
                    // --- Plain Text Matching ---
                    else { // If search_pattern exists but use_regex is false
                    // --- Plain Text Matching ---
                    const searchLines = search_pattern.split('\n');
                    let occurrencesFound = 0;
                    let matchStartIndex = -1;
                    let matchEndIndex = -1;

                    // Adjust search start point based on targetLineIndex
                    const searchStartLine = Math.min(targetLineIndex, lines.length -1); // Ensure search starts within bounds

                    for (let i = searchStartLine; i <= lines.length - searchLines.length; i++) {
                        // Ensure we don't search past the end if targetLineIndex was high
                        if (i < 0) continue;

                        let isMatch = true;
                        for (let j = 0; j < searchLines.length; j++) {
                            let fileLine = lines[i + j];
                            let searchLine = searchLines[j];

                            if (ignore_leading_whitespace) {
                                // Only trim if the search line isn't just whitespace itself
                                if (searchLine.trim().length > 0) {
                                    fileLine = fileLine.trimStart();
                                }
                                searchLine = searchLine.trimStart();
                            }
                            // Simple string comparison
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
                                break; // Found the desired occurrence
                            }
                        }
                    }

                    if (matchStartIndex !== -1) {
                        // Match found!
                        let indent = '';
                        if (preserve_indentation && matchStartIndex < lines.length) {
                             indent = getIndentation(lines[matchStartIndex]);
                        }

                        if (replace_content !== undefined) {
                            // --- Replace ---
                            const replacementLines = applyIndentation(replace_content, indent);
                            lines.splice(matchStartIndex, matchEndIndex - matchStartIndex, ...replacementLines);
                            changeSucceeded = true;
                        } else {
                            // --- Delete ---
                            lines.splice(matchStartIndex, matchEndIndex - matchStartIndex);
                            changeSucceeded = true;
                        }
                    } else {
                         console.warn(`[editFile] Search pattern not found (occurrence ${match_occurrence}) starting near line ${start_line} in ${relativePath}. Skipping change.`);
                    }
                // End of the main 'else if (search_pattern)' block.
                // The case where both search_pattern and replace_content are missing
                // should be caught by the Zod schema refinement.

                }
                if (changeSucceeded) {
                    changesAppliedToFile = true;
                    // Update the *other* state variable to ensure consistency
                    if (use_regex) {
                        // Regex modified currentContent, so update lines from it
                        lines = (currentContent as string).split('\n');
                    } else {
                        // Insertion/Plain Text modified lines, so update currentContent from it
                        currentContent = lines.join('\n');
                    }
                    // Now both currentContent and lines should be consistent after the change
                }

            } // End loop through changes for this file

            // --- Finalize File Processing ---
            if (changesAppliedToFile && currentContent !== null && originalContent !== null) {
                fileResult.status = 'success';

                // Generate diff if requested
                if (output_diff) {
                    fileResult.diff = createPatch(
                        relativePath, // File name for the diff header
                        originalContent,
                        currentContent, // Use the final state after all changes
                        '', // oldHeader
                        '', // newHeader
                        { context: 3 } // Number of context lines
                    );
                }

                // Write changes if not a dry run
                if (!dry_run) {
                    await fs.writeFile(absolutePath, currentContent, 'utf-8');
                    fileResult.message = `File ${relativePath} modified successfully.`;
                } else {
                    fileResult.message = `File ${relativePath} changes calculated (dry run).`;
                }
            } else if (fileProcessed && !changesAppliedToFile && fileResult.status !== 'failed') {
                 // Processed the file, but no changes were applicable or succeeded,
                 // AND the status wasn't already set to 'failed' (e.g., by invalid regex)
                 fileResult.status = 'skipped';
                 fileResult.message = `No applicable changes found or made for ${relativePath}.`;
            }
            // If !fileProcessed, it remains 'skipped' by default

        }
        } catch (error: any) {
            console.error(`[editFile] Error processing ${relativePath}:`, error);
            // Only set failure status and message if not already set by a more specific error (like invalid regex)
            if (fileResult.status !== 'failed' || !fileResult.message) {
                fileResult.status = 'failed';
                if (error instanceof McpError) {
                    fileResult.message = error.message;
                } else if (error.code) { // Node.js fs errors
                    fileResult.message = `Filesystem error (${error.code}) processing ${relativePath}.`;
                } else {
                    fileResult.message = `Unexpected error processing ${relativePath}: ${error.message || error}`;
                }
            }
        } finally {
            results.push(fileResult);
        }
    } // End loop through files

    // Wrap the results in the standard MCP content structure
    return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
}

// --- Tool Definition Export ---

export const editFileDefinition: ToolDefinition = {
    name: 'edit_file',
    description: 'Make selective edits to one or more files using advanced pattern matching and formatting options. Supports insertion, deletion, and replacement with indentation preservation and diff output. Recommended for modifying existing files, especially for complex changes or when precise control is needed.',
    schema: EditFileArgsSchema,
    handler: handleEditFile,
};