import { promises as fs } from "fs";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js'; // Use .js extension

/**
 * Handles the 'delete_items' MCP tool request.
 * Deletes multiple specified files or directories.
 */
export const handleDeleteItems = async (args: any) => {
    const pathsToDelete = args?.paths;
    if (!Array.isArray(pathsToDelete) || pathsToDelete.length === 0 || !pathsToDelete.every(p => typeof p === 'string')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    }

    // Define result structure
    type DeleteResult = {
        path: string;
        success: boolean;
        note?: string;
        error?: string;
    };

    const results = await Promise.allSettled(pathsToDelete.map(async (relativePath): Promise<DeleteResult> => {
        const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
        try {
            const targetPath = resolvePath(relativePath);
            if (targetPath === PROJECT_ROOT) {
                return { path: pathOutput, success: false, error: 'Deleting the project root is not allowed.' };
            }
            await fs.rm(targetPath, { recursive: true, force: true });
            return { path: pathOutput, success: true };
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // If the path doesn't exist, consider it a "successful" deletion in the sense that the goal is achieved.
                return { path: pathOutput, success: true, note: 'Path not found, nothing to delete' };
            }
            if (error instanceof McpError) {
                return { path: pathOutput, success: false, error: error.message };
            }
            console.error(`[Filesystem MCP - deleteItems] Error deleting item ${relativePath}:`, error);
            return { path: pathOutput, success: false, error: `Failed to delete: ${error.message}` };
        }
    }));

    // Process results from Promise.allSettled
    const outputResults: DeleteResult[] = results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            console.error(`[Filesystem MCP - deleteItems] Unexpected rejection for path ${pathsToDelete[index]}:`, result.reason);
            return { path: pathsToDelete[index].replace(/\\/g, '/'), success: false, error: 'Unexpected error during processing.' };
        }
    });

     // Sort results by original path order for predictability
    outputResults.sort((a, b) => pathsToDelete.indexOf(a.path) - pathsToDelete.indexOf(b.path));

    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};