import { promises as fs } from "fs";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js'; // Use .js extension

/**
 * Handles the 'create_directories' MCP tool request.
 * Creates multiple specified directories (including intermediate ones).
 */
export const handleCreateDirectories = async (args: any) => {
    const pathsToCreate = args?.paths;
    if (!Array.isArray(pathsToCreate) || pathsToCreate.length === 0 || !pathsToCreate.every(p => typeof p === 'string')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid or empty required parameter: paths (must be a non-empty array of strings)');
    }

    // Define result structure
    type CreateDirResult = {
        path: string;
        success: boolean;
        note?: string;
        error?: string;
        resolvedPath: string; // Include resolved path for debugging
    };

    const results = await Promise.allSettled(pathsToCreate.map(async (relativePath): Promise<CreateDirResult> => {
        const pathOutput = relativePath.replace(/\\/g, '/'); // Ensure consistent path separators early
        let targetPath: string = ''; // Initialize targetPath
        try {
            targetPath = resolvePath(relativePath); // Assign resolved path
            if (targetPath === PROJECT_ROOT) {
                return { path: pathOutput, success: false, error: 'Creating the project root is not allowed.', resolvedPath: targetPath };
            }
            console.error(`[handleCreateDirectories] Attempting to create directory at resolved path: ${targetPath}`); // Log resolved path
            await fs.mkdir(targetPath, { recursive: true });
            console.error(`[handleCreateDirectories] Successfully created directory: ${targetPath}`); // Log success
            return { path: pathOutput, success: true, resolvedPath: targetPath };
        } catch (error: any) {
             if (error.code === 'EEXIST') {
                 try {
                     const stats = await fs.stat(targetPath); // targetPath should be assigned here
                     if (stats.isDirectory()) {
                         return { path: pathOutput, success: true, note: 'Directory already exists', resolvedPath: targetPath };
                     } else {
                         return { path: pathOutput, success: false, error: 'Path exists but is not a directory', resolvedPath: targetPath };
                     }
                 } catch (statError: any) {
                     console.error(`[Filesystem MCP - createDirs] Error stating existing path ${targetPath}:`, statError);
                     return { path: pathOutput, success: false, error: `Failed to create directory: ${statError.message}`, resolvedPath: targetPath };
                 }
             }
             if (error.code === 'EPERM' || error.code === 'EACCES') {
                 console.error(`[Filesystem MCP - createDirs] Permission error creating directory ${targetPath}:`, error);
                 return { path: pathOutput, success: false, error: `Permission denied creating directory: ${error.message}`, resolvedPath: targetPath };
             }
             if (error instanceof McpError) {
                 // Add resolvedPath if available, otherwise use placeholder
                 return { path: pathOutput, success: false, error: error.message, resolvedPath: targetPath || 'Resolution failed' };
             }
             // Generic error fallback
             console.error(`[Filesystem MCP - createDirs] Error creating directory ${targetPath}:`, error);
             return { path: pathOutput, success: false, error: `Failed to create directory: ${error.message}`, resolvedPath: targetPath || 'Resolution failed' };
         }
    }));

    // Process results from Promise.allSettled
    const outputResults: CreateDirResult[] = results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            console.error(`[Filesystem MCP - createDirs] Unexpected rejection for path ${pathsToCreate[index]}:`, result.reason);
            // Try to include resolvedPath even in rejection case if possible, might be tricky
            return { path: pathsToCreate[index].replace(/\\/g, '/'), success: false, error: 'Unexpected error during processing.', resolvedPath: 'Unknown on rejection' };
        }
    });

    // Sort results by original path order for predictability
    outputResults.sort((a, b) => pathsToCreate.indexOf(a.path) - pathsToCreate.indexOf(b.path));

    return { content: [{ type: "text", text: JSON.stringify(outputResults, null, 2) }] };
};