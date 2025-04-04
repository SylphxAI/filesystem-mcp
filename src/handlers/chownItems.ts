import { promises as fs } from "fs";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js'; // Use .js extension

/**
 * Handles the 'chown_items' MCP tool request.
 * Changes owner (UID) and group (GID) for multiple specified files/directories.
 * Note: This may have limited effect or require specific permissions on non-POSIX systems like Windows.
 */
export const handleChownItems = async (args: any) => {
    const relativePaths = args?.paths;
    const uid = args?.uid;
    const gid = args?.gid;

    if (!Array.isArray(relativePaths) || relativePaths.length === 0 || !relativePaths.every(p => typeof p === 'string')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    }
    if (typeof uid !== 'number') {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or missing required parameter: uid (must be a number)');
    }
    if (typeof gid !== 'number') {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or missing required parameter: gid (must be a number)');
    }

    // Define result structure
    type ChownResult = {
        path: string;
        success: boolean;
        uid?: number; // Include uid/gid on success
        gid?: number;
        error?: string;
    };

    const results = await Promise.allSettled(relativePaths.map(async (relativePath): Promise<ChownResult> => {
        const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
        try {
            const targetPath = resolvePath(relativePath);
            if (targetPath === PROJECT_ROOT) {
                return { path: pathOutput, success: false, error: 'Changing ownership of the project root is not allowed.' };
            }
            await fs.chown(targetPath, uid, gid);
            return { path: pathOutput, success: true, uid, gid };
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return { path: pathOutput, success: false, error: 'Path not found' };
            }
            if (error.code === 'EPERM') {
                // Common error on Windows or insufficient permissions
                return { path: pathOutput, success: false, error: 'Operation not permitted (Permissions or unsupported on OS)' };
            }
            if (error instanceof McpError) {
                return { path: pathOutput, success: false, error: error.message };
            }
            console.error(`[Filesystem MCP - chownItems] Error changing ownership for ${relativePath}:`, error);
            return { path: pathOutput, success: false, error: `Failed to change ownership: ${error.message}` };
        }
    }));

    // Process results from Promise.allSettled
    const outputResults: ChownResult[] = results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            console.error(`[Filesystem MCP - chownItems] Unexpected rejection for path ${relativePaths[index]}:`, result.reason);
            return { path: relativePaths[index].replace(/\\/g, '/'), success: false, error: 'Unexpected error during processing.' };
        }
    });

    // Sort results by original path order for predictability
    outputResults.sort((a, b) => relativePaths.indexOf(a.path) - relativePaths.indexOf(b.path));

    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};