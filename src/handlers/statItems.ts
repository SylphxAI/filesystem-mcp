import { promises as fs } from "fs";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath } from '../utils/pathUtils.js'; // Use .js extension
import { formatStats } from '../utils/statsUtils.js'; // Use .js extension

/**
 * Handles the 'stat_items' MCP tool request.
 * Gets detailed status information for multiple specified paths.
 */
export const handleStatItems = async (args: any) => {
    const pathsToStat = args?.paths;
    if (!Array.isArray(pathsToStat) || pathsToStat.length === 0 || !pathsToStat.every(p => typeof p === 'string')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    }

    // Define the structure for results more explicitly
    type StatResult = {
        path: string;
        status: 'success' | 'error';
        stats?: ReturnType<typeof formatStats>;
        error?: string;
    };
    const results: StatResult[] = [];

    await Promise.allSettled(pathsToStat.map(async (relativePath) => {
        const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
        try {
            const targetPath = resolvePath(relativePath);
            const stats = await fs.stat(targetPath);
            results.push({ path: pathOutput, status: 'success', stats: formatStats(relativePath, targetPath, stats) });
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                results.push({ path: pathOutput, status: 'error', error: 'Path not found' });
            } else if (error instanceof McpError) {
                results.push({ path: pathOutput, status: 'error', error: error.message });
            } else {
                console.error(`[Filesystem MCP - statItems] Error stating item ${relativePath}:`, error);
                results.push({ path: pathOutput, status: 'error', error: `Failed to get stats: ${error.message}` });
            }
        }
    }));

    // Sort results by original path order for predictability, although Promise.allSettled usually preserves order
    results.sort((a, b) => pathsToStat.indexOf(a.path) - pathsToStat.indexOf(b.path));

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
};