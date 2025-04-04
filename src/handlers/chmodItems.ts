import { promises as fs } from "fs";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js'; // Use .js extension

/**
 * Handles the 'chmod_items' MCP tool request.
 * Changes permissions mode for multiple specified files/directories.
 */
export const handleChmodItems = async (args: any) => {
    const relativePaths = args?.paths;
    const modeString = args?.mode;

    if (!Array.isArray(relativePaths) || relativePaths.length === 0 || !relativePaths.every(p => typeof p === 'string')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    }
    if (typeof modeString !== 'string' || !/^[0-7]{3,4}$/.test(modeString)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid required parameter: mode (must be an octal string like \'755\')');
    }
    const mode = parseInt(modeString, 8);

    // Define result structure
    type ChmodResult = {
        path: string;
        success: boolean;
        mode?: string; // Include mode on success
        error?: string;
    };

    const results = await Promise.allSettled(relativePaths.map(async (relativePath): Promise<ChmodResult> => {
        const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
        try {
            const targetPath = resolvePath(relativePath);
            if (targetPath === PROJECT_ROOT) {
                return { path: pathOutput, success: false, error: 'Changing permissions of the project root is not allowed.' };
            }
            await fs.chmod(targetPath, mode);
            return { path: pathOutput, success: true, mode: modeString };
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return { path: pathOutput, success: false, error: 'Path not found' };
            }
            if (error instanceof McpError) {
                return { path: pathOutput, success: false, error: error.message };
            }
            // Note: EPERM might occur on Windows or if user lacks permissions
            console.error(`[Filesystem MCP - chmodItems] Error changing mode for ${relativePath}:`, error);
            return { path: pathOutput, success: false, error: `Failed to change mode: ${error.message}` };
        }
    }));

    // Process results from Promise.allSettled
    const outputResults: ChmodResult[] = results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            console.error(`[Filesystem MCP - chmodItems] Unexpected rejection for path ${relativePaths[index]}:`, result.reason);
            return { path: relativePaths[index].replace(/\\/g, '/'), success: false, error: 'Unexpected error during processing.' };
        }
    });

    // Sort results by original path order for predictability
    outputResults.sort((a, b) => relativePaths.indexOf(a.path) - relativePaths.indexOf(b.path));

    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};