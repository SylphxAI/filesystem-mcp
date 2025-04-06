// src/handlers/listFiles.ts
// Import PathLike and ensure Dirent, Stats, StatOptions are imported
import type { Stats, Dirent, StatOptions, PathLike } from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { z } from 'zod';
import type { Path as GlobPath, GlobOptions } from 'glob';
import { glob as globFn } from 'glob';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  resolvePath as resolvePathUtil,
  PROJECT_ROOT as projectRootUtil,
} from '../utils/pathUtils.js';
import type { FormattedStats } from '../utils/statsUtils.js'; // Import the interface
import { formatStats as formatStatsUtil } from '../utils/statsUtils.js';

// Define the expected MCP response structure locally
interface McpToolResponse {
  content: { type: 'text'; text: string }[];
}

// Define Zod schema (remains the same)
export const ListFilesArgsSchema = z
  .object({
    path: z
      .string()
      .optional()
      .default('.')
      .describe('Relative path of the directory.'),
    recursive: z
      .boolean()
      .optional()
      .default(false)
      .describe('List directories recursively.'),
    include_stats: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include detailed stats for each listed item.'),
  })
  .strict();

type ListFilesArgs = z.infer<typeof ListFilesArgsSchema>;

// --- Define Dependencies Interface ---
// Use PathLike and simplify complex function types with 'any' for injection compatibility
export interface ListFilesDependencies {
  stat: (p: PathLike, opts?: StatOptions) => Promise<Stats>;
  readdir: (p: PathLike, options?: any) => Promise<string[] | Dirent[]>; // Simplified options
  glob: (
    pattern: string | string[],
    options: GlobOptions,
  ) => Promise<string[] | GlobPath[]>;
  resolvePath: (userPath: string) => string;
  PROJECT_ROOT: string;
  formatStats: (
    // Use the imported interface type
    relativePath: string,
    absolutePath: string,
    stats: Stats,
  ) => FormattedStats;
  path: Pick<
    typeof path,
    'join' | 'dirname' | 'resolve' | 'relative' | 'basename'
  >;
}

/**
 * Handles the 'list_files' MCP tool request (with dependency injection).
 * Lists files and directories, optionally recursively and with stats.
 */
// Export the core function for testing
export const handleListFilesFunc = async (
  deps: ListFilesDependencies,
  args: unknown,
): Promise<McpToolResponse> => {
  // Add return type
  let parsedArgs: ListFilesArgs;
  try {
    parsedArgs = ListFilesArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }

  const {
    path: relativeInputPath,
    recursive,
    include_stats: includeStats,
  } = parsedArgs;
  const targetAbsolutePath = deps.resolvePath(relativeInputPath);

  try {
    const initialStats = await deps.stat(targetAbsolutePath);

    if (initialStats.isFile()) {
      const statsResult = deps.formatStats(
        relativeInputPath,
        targetAbsolutePath,
        initialStats,
      );
      const outputJson = JSON.stringify(statsResult, null, 2);
      return { content: [{ type: 'text', text: outputJson }] };
    }

    if (initialStats.isDirectory()) {
      const results: {
        path: string;
        stats?: FormattedStats | { error: string }; // Use imported interface type
      }[] = [];

      // Corrected logical AND: &&
      if (!recursive && !includeStats) {
        // Request Dirent objects, the return type should be Dirent[]
        const entries = (await deps.readdir(targetAbsolutePath, {
          withFileTypes: true,
        })) as Dirent[]; // Assert as Dirent[]
        for (const entry of entries) {
          // entry is now Dirent, use entry.name
          const name = entry.name;
          const itemRelativePath = deps.path.join(relativeInputPath, name);
          let isDirectory = false;
          try {
            // Use Dirent type info directly
            if (entry.isDirectory()) {
              isDirectory = true;
            } else if (entry.isFile()) {
              // Check isFile() as well
              isDirectory = false;
            } else {
              // Fallback to stat for other types like symlinks if necessary
              const itemFullPath = deps.path.resolve(targetAbsolutePath, name);
              const itemStats = await deps.stat(itemFullPath);
              isDirectory = itemStats.isDirectory();
            }
          } catch (statError: any) {
            console.warn(
              `[Filesystem MCP - listFiles] Could not determine type for item ${itemRelativePath} during readdir: ${statError.message}`,
            );
          }
          const displayPath = isDirectory
            ? `${itemRelativePath.replace(/\\/g, '/')}/`
            : itemRelativePath.replace(/\\/g, '/');
          results.push({ path: displayPath });
        }
      } else {
        const globPattern = recursive ? '**/*' : '*';
        try {
          const globOptions: GlobOptions = {
            cwd: targetAbsolutePath,
            dot: true,
            mark: false,
            nodir: false,
            stat: false,
            withFileTypes: false,
            absolute: false,
          };
          const pathsFromGlob = await deps.glob(globPattern, globOptions);

          for (const entry of pathsFromGlob) {
            let displayPath: string;
            let statsResult:
              | FormattedStats // Use imported interface type
              | { error: string }
              | undefined = undefined;
            const pathRelativeGlob = entry as string;
            const relativeToRoot = deps.path.join(
              relativeInputPath,
              pathRelativeGlob,
            );
            const absolutePath = deps.path.resolve(
              targetAbsolutePath,
              pathRelativeGlob,
            );

            if (pathRelativeGlob === '.' || pathRelativeGlob === '') {
              continue;
            }

            let isDirectory = false;
            try {
              const entryStats = await deps.stat(absolutePath);
              isDirectory = entryStats.isDirectory();
              if (includeStats) {
                statsResult = deps.formatStats(
                  relativeToRoot,
                  absolutePath,
                  entryStats,
                );
              }
            } catch (statError: any) {
              console.warn(
                `[Filesystem MCP - listFiles] Could not get stats for ${relativeToRoot}: ${statError.message}`,
              );
              if (includeStats) {
                statsResult = {
                  error: `Could not get stats: ${statError.message}`,
                };
              }
            }
            displayPath = relativeToRoot.replace(/\\/g, '/');
            // Corrected logical AND: &&
            if (isDirectory && !displayPath.endsWith('/')) {
              displayPath += '/';
            }
            if (includeStats) {
              results.push({
                path: displayPath,
                ...(statsResult && { stats: statsResult }),
              }); // Use conditional spread
            } else {
              results.push({ path: displayPath });
            }
          }
        } catch (globError: any) {
          console.error(
            `[Filesystem MCP] Error during glob execution or processing for ${targetAbsolutePath}:`,
            globError,
          );
          // Wrap the glob error in an McpError
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to list files using glob: ${globError.message}`,
            { cause: globError },
          );
        }
      }

      const resultData = includeStats
        ? results
        : results.map((item) => item.path);
      const outputJson = JSON.stringify(resultData, null, 2);
      return { content: [{ type: 'text', text: outputJson }] };
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Path is neither a file nor a directory: ${relativeInputPath}`,
    );
  } catch (error: any) {
    if (error.code === 'ENOENT')
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Path not found: ${relativeInputPath}`,
        { cause: error },
      );
    if (error instanceof McpError) throw error;
    console.error(
      `[Filesystem MCP] Error in listFiles for ${targetAbsolutePath}:`,
      error,
    );
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to process path: ${error.message}`,
      { cause: error },
    );
  }
};

// --- Tool Definition ---
const productionHandler = (args: unknown) => {
  // Assign actual functions, relying on TypeScript's inference or using 'as any' if needed for complex overloads
  const dependencies: ListFilesDependencies = {
    stat: fsPromises.stat as any, // Use 'as any' to bypass complex overload checks if necessary
    readdir: fsPromises.readdir as any, // Use 'as any'
    glob: globFn,
    resolvePath: resolvePathUtil,
    PROJECT_ROOT: projectRootUtil,
    formatStats: formatStatsUtil,
    path: {
      join: path.join,
      dirname: path.dirname,
      resolve: path.resolve,
      relative: path.relative,
      basename: path.basename,
    },
  };
  return handleListFilesFunc(dependencies, args);
};

export const listFilesToolDefinition = {
  name: 'list_files',
  description:
    'List files/directories. Can optionally include stats and list recursively.',
  schema: ListFilesArgsSchema,
  handler: productionHandler,
};
