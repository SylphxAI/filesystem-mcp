import { promises as fs } from "fs";
import { z } from 'zod';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath } from '../utils/pathUtils.js';
import { formatStats } from '../utils/statsUtils.js';

/**
 * Handles the 'stat_items' MCP tool request.
 * Gets detailed status information for multiple specified paths.
 */

// Define Zod schema for arguments
const StatItemsArgsSchema = z.object({
  paths: z.array(z.string()).min(1, { message: "Paths array cannot be empty" }),
}).strict();

// Infer TypeScript type from schema
type StatItemsArgs = z.infer<typeof StatItemsArgsSchema>;

export const handleStatItems = async (args: unknown) => {
    // Validate and parse arguments
    let parsedArgs: StatItemsArgs;
    try {
        parsedArgs = StatItemsArgsSchema.parse(args);
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${error.errors.map(e => `${e.path.join('.')} (${e.message})`).join(', ')}`);
        }
        throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
    }
    const { paths: pathsToStat } = parsedArgs;

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
}; // <<< Add missing closing brace
// Removed extra closing brace