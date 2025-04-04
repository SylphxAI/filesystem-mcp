import { promises as fs, Stats } from "fs";
import path from "path";
import { z } from 'zod'; // Keep Zod for error checking
import { glob, Path, GlobOptions } from 'glob';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolvePath, PROJECT_ROOT } from '../utils/pathUtils.js';
import { formatStats } from '../utils/statsUtils.js';
// Import the shared schema and type // Removed this line
// Define Zod schema and export it
export const ListFilesArgsSchema = z.object({
  path: z.string().optional().default(".").describe("Relative path of the directory."),
  recursive: z.boolean().optional().default(false).describe("List directories recursively."),
  include_stats: z.boolean().optional().default(false).describe("Include detailed stats for each listed item."),
}).strict();

// Infer TypeScript type
type ListFilesArgs = z.infer<typeof ListFilesArgsSchema>;
/**
 * Handles the 'list_files' MCP tool request.
 * Lists files and directories, optionally recursively and with stats.
 */
const handleListFilesFunc = async (args: unknown) => {
  // Validate and parse arguments
  let parsedArgs: ListFilesArgs;
  try {
    parsedArgs = ListFilesArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${error.errors.map(e => `${e.path.join('.')} (${e.message})`).join(', ')}`);
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }

  const { path: relativeInputPath, recursive, include_stats: includeStats } = parsedArgs;
  const targetAbsolutePath = resolvePath(relativeInputPath); // Absolute path of the item requested

  // Removed debugLogs array declaration
  try {
    const initialStats = await fs.stat(targetAbsolutePath);

    // Case 1: Path points to a file
    if (initialStats.isFile()) {
      // Always return stats for a single file path, regardless of includeStats flag
      const statsResult = formatStats(relativeInputPath, targetAbsolutePath, initialStats);
      // Note: Returning logs even for single file case for consistency, though few logs generated here.
      // Return just the stats result for single file case
      const outputJson = JSON.stringify(statsResult, null, 2);
      return { content: [{ type: "text", text: outputJson }] };
    }

    // Case 2: Path points to a directory
    if (initialStats.isDirectory()) {
      let results: { path: string; stats?: ReturnType<typeof formatStats> | { error: string } }[] = [];
      // Removed comment about moved debugLogs declaration
      // Construct glob pattern relative to PROJECT_ROOT
      // const globPattern = path.join(relativeInputPath, recursive ? '**/*' : '*').replace(/\\/g, '/'); // Old pattern relative to PROJECT_ROOT

      // --- Use fs.readdir for simple, non-recursive, no-stats case ---
      if (!recursive && !includeStats) {
          // Removed debug log
          const names = await fs.readdir(targetAbsolutePath);
          for (const name of names) {
              const itemRelativePath = path.join(relativeInputPath, name);
              // We need to stat to determine if it's a directory for the trailing slash
              let isDirectory = false;
              try {
                  const itemFullPath = path.resolve(targetAbsolutePath, name); // Use targetAbsolutePath which is already resolved
                  const itemStats = await fs.stat(itemFullPath);
                  isDirectory = itemStats.isDirectory();
              } catch (statError: any) {
                  console.warn(`[Filesystem MCP - listFiles] Could not stat item ${itemRelativePath} during readdir: ${statError.message}`); // Keep console warn
                  // Decide whether to include the item even if stat fails, maybe add error?
                  // For now, just skip adding the trailing slash if stat fails
              }
              const displayPath = isDirectory ? `${itemRelativePath.replace(/\\/g, '/')}/` : itemRelativePath.replace(/\\/g, '/');
              results.push({ path: displayPath });
          }
      } else {
          // --- Use glob for recursive or stats-included cases ---
          const globPattern = recursive ? '**/*' : '*';
          // Use targetAbsolutePath as cwd, pattern is relative to it
          // Removed debug log
          try { // Keep inner try block

          let pathsFromGlob: string[] | Path[];
          let globOptions: GlobOptions;

          // Always run glob without stat: true, get relative paths
          globOptions = {
              cwd: targetAbsolutePath,
              dot: true,
              mark: false, // Let's not add trailing slash here, handle later based on stat
              nodir: false, // Include directories in the list
              stat: false, // *** Always false ***
              withFileTypes: false, // Expect string[]
              absolute: false // Expect paths relative to cwd
          };
          // Removed debug log
          pathsFromGlob = await glob(globPattern, globOptions); // Expect string[]

          // Removed debug log

          // Process results
          for (const entry of pathsFromGlob) {
              let displayPath: string;
              let statsResult: ReturnType<typeof formatStats> | { error: string } | undefined = undefined;

              // Entry is now always a string relative to cwd (targetAbsolutePath)
              const pathRelativeGlob = entry as string;
              // Construct path relative to project root for output display
              const relativeToRoot = path.join(relativeInputPath, pathRelativeGlob);
              // Resolve absolute path for fs.stat
              const absolutePath = path.resolve(targetAbsolutePath, pathRelativeGlob);

              // Skip the base directory itself (glob shouldn't return '.' with cwd set)
              if (pathRelativeGlob === '.' || pathRelativeGlob === '') {
                  // Removed debug log
                  continue;
              }

              let isDirectory = false; // Default assumption

              if (includeStats) {
                  try {
                      // Removed debug log
                      const entryStats = await fs.stat(absolutePath); // Use fs.stat
                      isDirectory = entryStats.isDirectory(); // Check if it's a directory
                      statsResult = formatStats(relativeToRoot, absolutePath, entryStats);
                      // Removed debug log
                  } catch (statError: any) {
                      console.warn(`[Filesystem MCP - listFiles] Could not get stats for ${relativeToRoot}: ${statError.message}`); // Keep console warn
                      statsResult = { error: `Could not get stats: ${statError.message}` };
                      // Cannot determine if it's a directory if stat fails
                  }
                  // Add trailing slash based on successful stat
                  displayPath = relativeToRoot.replace(/\\/g, '/');
                  if (isDirectory && !displayPath.endsWith('/')) {
                      displayPath += '/';
                  }
                  results.push({ path: displayPath, stats: statsResult });
              } else {
                  // No stats needed, just format the path
                  // We need to stat anyway to determine if it's a directory for the trailing slash
                  try {
                      const entryStats = await fs.stat(absolutePath);
                      isDirectory = entryStats.isDirectory();
                  } catch (statError: any) {
                      console.warn(`[Filesystem MCP - listFiles] Could not stat ${relativeToRoot} just for directory check: ${statError.message}`); // Keep console warn
                      // Assume not a directory if stat fails
                  }
                  displayPath = relativeToRoot.replace(/\\/g, '/');
                  if (isDirectory && !displayPath.endsWith('/')) {
                      displayPath += '/';
                  }
                  results.push({ path: displayPath });
              }
               // Removed debug log
          } // End for loop
          } catch (globError: any) { // Keep inner catch block
              // Removed debug log push
              console.error(`[Filesystem MCP] Error during glob execution or processing for ${targetAbsolutePath}:`, globError); // Keep server log
              throw globError; // Re-throw to be caught by the outer catch
          }
      } // End else (use glob)

      // Prepare final result (array of paths or array of objects with stats) - THIS IS NOW CORRECTLY PLACED
      const resultData = includeStats ? results : results.map(item => item.path);
      // Return the results directly
      const outputJson = JSON.stringify(resultData, null, 2);
      return { content: [{ type: "text", text: outputJson }] };
      // Original return statement removed/replaced above

    } // End if (initialStats.isDirectory())

    // This path should not be reached if the initial path is a file or directory
    throw new McpError(ErrorCode.InternalError, `Path is neither a file nor a directory: ${relativeInputPath}`);

  } catch (error: any) { // Correctly placed catch block
    if (error.code === 'ENOENT') throw new McpError(ErrorCode.InvalidRequest, `Path not found: ${relativeInputPath}`, { cause: error }); // Remove logs from error details
    if (error instanceof McpError) throw error;
    console.error(`[Filesystem MCP] Error in listFiles for ${targetAbsolutePath}:`, error); // Keep this console log for server-side debugging
    throw new McpError(ErrorCode.InternalError, `Failed to process path: ${error.message}`, { cause: error }); // Remove logs from error details
  }
};

// Export the complete tool definition
export const listFilesToolDefinition = {
    name: "list_files",
    description: "List files/directories. Can optionally include stats and list recursively.",
    schema: ListFilesArgsSchema,
    handler: handleListFilesFunc,
};