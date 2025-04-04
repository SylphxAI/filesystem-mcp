import { promises as fs } from "fs";
import path from "path";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js'; // Use .js extension

/**
 * Handles the 'move_items' MCP tool request.
 * Moves or renames multiple specified files/directories.
 */
export const handleMoveItems = async (args: any) => {
    const operations = args?.operations;
    if (!Array.isArray(operations) || operations.length === 0 || !operations.every((op: any) => typeof op === 'object' && typeof op.source === 'string' && typeof op.destination === 'string')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: operations (must be a non-empty array of {source: string, destination: string} objects)');
    }

    // Define result structure
    type MoveResult = {
        source: string;
        destination: string;
        success: boolean;
        error?: string;
    };

    const results = await Promise.allSettled(operations.map(async (op): Promise<MoveResult> => {
        const sourceRelative = op.source;
        const destinationRelative = op.destination;
        const sourceOutput = sourceRelative.replace(/\\/g, '/'); // Ensure consistent path separators early
        const destOutput = destinationRelative.replace(/\\/g, '/');

        try {
            const sourceAbsolute = resolvePath(sourceRelative);
            const destinationAbsolute = resolvePath(destinationRelative);

            if (sourceAbsolute === PROJECT_ROOT) {
                return { source: sourceOutput, destination: destOutput, success: false, error: 'Moving the project root is not allowed.' };
            }
            // Security Note: resolvePath already prevents destinationAbsolute from being outside PROJECT_ROOT

            // Ensure parent directory of destination exists before moving
            const destDir = path.dirname(destinationAbsolute);
            await fs.mkdir(destDir, { recursive: true });

            // Now attempt the move/rename
            await fs.rename(sourceAbsolute, destinationAbsolute);
            return { source: sourceOutput, destination: destOutput, success: true };
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return { source: sourceOutput, destination: destOutput, success: false, error: `Source path not found: ${sourceRelative}` };
            }
            if (error.code === 'EPERM' || error.code === 'EACCES') {
                return { source: sourceOutput, destination: destOutput, success: false, error: `Permission denied moving '${sourceRelative}' to '${destinationRelative}'.` };
            }
            // TODO: Consider handling EXDEV (cross-device link) by copying and deleting if needed
            if (error instanceof McpError) {
                return { source: sourceOutput, destination: destOutput, success: false, error: error.message };
            }
            console.error(`[Filesystem MCP - moveItems] Error moving item from ${sourceRelative} to ${destinationRelative}:`, error);
            return { source: sourceOutput, destination: destOutput, success: false, error: `Failed to move item: ${error.message}` };
        }
    }));

    // Process results from Promise.allSettled
    const outputResults: MoveResult[] = results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            const op = operations[index];
            console.error(`[Filesystem MCP - moveItems] Unexpected rejection for operation ${JSON.stringify(op)}:`, result.reason);
            return { source: op?.source?.replace(/\\/g, '/') ?? 'unknown', destination: op?.destination?.replace(/\\/g, '/') ?? 'unknown', success: false, error: 'Unexpected error during processing.' };
        }
    });

    // Sort results by original operation order for predictability
    // Note: Sorting based on source path might be sufficient if order matters
    // outputResults.sort((a, b) => operations.findIndex(op => op.source === a.source) - operations.findIndex(op => op.source === b.source));

    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};