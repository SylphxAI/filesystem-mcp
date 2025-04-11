// src/handlers/listFiles.ts
import type { Stats, Dirent, StatOptions, PathLike } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Path as GlobPath, GlobOptions } from 'glob';
import { glob as globFn } from 'glob';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  resolvePath as resolvePathUtil,
  PROJECT_ROOT as projectRootUtil,
} from '../utils/path-utils.js';
import type { FormattedStats } from '../utils/stats-utils.js';
import { formatStats as formatStatsUtil } from '../utils/stats-utils.js';

import type { McpToolResponse } from '../types/mcp-types.js';

// Define Zod schema
export const ListFilesArgsSchema = z
  .object({
    path: z.string().optional().default('.').describe('Relative path of the directory.'),
    recursive: z.boolean().optional().default(false).describe('List directories recursively.'),
    include_stats: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include detailed stats for each listed item.'),
  })
  .strict();

type ListFilesArgs = z.infer<typeof ListFilesArgsSchema>;

// Define Dependencies Interface
export interface ListFilesDependencies {
  stat: (p: PathLike, opts?: StatOptions & { bigint?: false }) => Promise<Stats>;
  readdir: (
    p: PathLike,
    options?: { withFileTypes?: true }, // Specify options type
  ) => Promise<string[] | Dirent[]>;
  glob: (pattern: string | string[], options: GlobOptions) => Promise<string[] | GlobPath[]>;
  resolvePath: (userPath: string) => string;
  PROJECT_ROOT: string;
  formatStats: (relativePath: string, absolutePath: string, stats: Stats) => FormattedStats;
  path: Pick<typeof path, 'join' | 'dirname' | 'resolve' | 'relative' | 'basename'>;
}

// --- Helper Function Types ---
interface ProcessedEntry {
  path: string;
  stats?: FormattedStats | { error: string };
}

// --- Parameter Interfaces for Refactored Functions ---
interface ProcessGlobEntryParams {
  deps: ListFilesDependencies;
  entryPath: string; // Path relative to glob cwd
  baseAbsolutePath: string;
  baseRelativePath: string;
  includeStats: boolean;
}

interface ListDirectoryWithGlobParams {
  deps: ListFilesDependencies;
  absolutePath: string;
  relativePath: string;
  recursive: boolean;
  includeStats: boolean;
}

interface HandleDirectoryCaseParams {
  deps: ListFilesDependencies;
  absolutePath: string;
  relativePath: string;
  recursive: boolean;
  includeStats: boolean;
}

interface ProcessInitialStatsParams {
  deps: ListFilesDependencies;
  initialStats: Stats;
  relativeInputPath: string;
  targetAbsolutePath: string;
  recursive: boolean;
  includeStats: boolean;
}

interface FormatStatsResultParams {
  deps: ListFilesDependencies;
  stats: Stats | undefined;
  statsError: string | undefined;
  relativeToRoot: string;
  absolutePath: string;
}

// --- Refactored Helper Functions ---

/** Parses and validates the input arguments. */
function parseAndValidateArgs(args: unknown): ListFilesArgs {
  try {
    return ListFilesArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')} (${e.message})`).join(', ')}`,
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Argument validation failed');
  }
}

/** Handles the case where the input path is a file. */
function handleFileCase(
  deps: ListFilesDependencies,
  relativePath: string,
  absolutePath: string,
  stats: Stats,
): McpToolResponse {
  const statsResult = deps.formatStats(relativePath, absolutePath, stats); // Pass absolutePath
  const outputJson = JSON.stringify(statsResult, null, 2);
  return { content: [{ type: 'text', text: outputJson }] };
}

/** Formats the final results into the MCP response. */
function formatResults(results: ProcessedEntry[], includeStats: boolean): McpToolResponse {
  const resultData = includeStats ? results : results.map((item) => item.path);
  const outputJson = JSON.stringify(resultData, null, 2);
  return { content: [{ type: 'text', text: outputJson }] };
}

/** Lists directory contents non-recursively without stats. */
async function listDirectoryNonRecursive(
  deps: ListFilesDependencies,
  absolutePath: string,
  relativePath: string,
): Promise<ProcessedEntry[]> {
  const results: ProcessedEntry[] = [];
  // Explicitly cast the result to Dirent[] as we use withFileTypes: true
  const entries = (await deps.readdir(absolutePath, {
    withFileTypes: true,
  })) as Dirent[];

  for (const entry of entries) {
    const name = entry.name;
    const itemRelativePath = deps.path.join(relativePath, name);
    let isDirectory = false;
    try {
      // Prioritize dirent type, fallback to stat
      if (entry.isDirectory()) {
        isDirectory = true;
      } else if (entry.isFile()) {
        isDirectory = false;
      } else if (entry.isSymbolicLink()) {
        // Handle symlinks by stating the target
        const itemFullPath = deps.path.resolve(absolutePath, name);
        const itemStats = await deps.stat(itemFullPath); // stat follows symlinks by default
        isDirectory = itemStats.isDirectory();
      }
    } catch (statError: unknown) {
      const errorMessage = statError instanceof Error ? statError.message : String(statError);
      console.warn(
        `[Filesystem MCP - listFiles] Could not determine type for item ${itemRelativePath} during readdir: ${errorMessage}`,
      );
      // Assume not a directory if stat fails, might be a broken link etc.
      isDirectory = false;
    }
    const displayPath = isDirectory
      ? `${itemRelativePath.replaceAll('\\', '/')}/`
      : itemRelativePath.replaceAll('\\', '/');
    results.push({ path: displayPath });
  }
  return results;
}

/** Gets stats for a glob entry, handling errors. */
async function getStatsForGlobEntry(
  deps: ListFilesDependencies,
  absolutePath: string,
  relativeToRoot: string,
): Promise<{ stats?: Stats; error?: string }> {
  try {
    const stats = await deps.stat(absolutePath);
    return { stats };
  } catch (statError: unknown) {
    const errorMessage = statError instanceof Error ? statError.message : String(statError);
    console.warn(
      `[Filesystem MCP - listFiles] Could not get stats for ${relativeToRoot}: ${errorMessage}`,
    );
    return { error: `Could not get stats: ${errorMessage}` };
  }
}

/** Formats the stats result for a glob entry. */
function formatStatsResult(
  params: FormatStatsResultParams, // Use interface
): FormattedStats | { error: string } | undefined {
  const { deps, stats, statsError, relativeToRoot, absolutePath } = params; // Destructure
  if (stats) {
    return deps.formatStats(relativeToRoot, absolutePath, stats); // Pass absolutePath
  } else if (statsError) {
    return { error: statsError };
  }
  return undefined;
}

/** Processes a single entry returned by glob. */
async function processGlobEntry(params: ProcessGlobEntryParams): Promise<ProcessedEntry | null> {
  const { deps, entryPath, baseAbsolutePath, baseRelativePath, includeStats } = params;

  const relativeToRoot = deps.path.join(baseRelativePath, entryPath);
  const absolutePath = deps.path.resolve(baseAbsolutePath, entryPath);

  // Skip the base directory itself if returned by glob
  if (entryPath === '.' || entryPath === '') {
    return null;
  }

  const { stats, error: statsError } = await getStatsForGlobEntry(
    deps,
    absolutePath,
    relativeToRoot,
  );

  const isDirectory = stats?.isDirectory() ?? entryPath.endsWith('/'); // Infer if stat failed
  let statsResult: FormattedStats | { error: string } | undefined = undefined;

  if (includeStats) {
    statsResult = formatStatsResult({
      // Pass object
      deps,
      stats,
      statsError,
      relativeToRoot,
      absolutePath,
    });
  }

  let displayPath = relativeToRoot.replaceAll('\\', '/');
  if (isDirectory && !displayPath.endsWith('/')) {
    displayPath += '/';
  }

  return {
    path: displayPath,
    ...(includeStats && statsResult && { stats: statsResult }),
  };
}

/** Lists directory contents using glob (for recursive or stats cases). */
async function listDirectoryWithGlob(
  params: ListDirectoryWithGlobParams,
): Promise<ProcessedEntry[]> {
  const { deps, absolutePath, relativePath, recursive, includeStats } = params;
  const results: ProcessedEntry[] = [];
  const globPattern = recursive ? '**/*' : '*';
  const globOptions: GlobOptions = {
    cwd: absolutePath,
    dot: true, // Include dotfiles
    mark: false, // We add slash manually based on stat
    nodir: false, // We need dirs to add slash
    stat: false, // We perform stat manually for better error handling
    withFileTypes: false, // Not reliable across systems/symlinks
    absolute: false, // Paths relative to cwd
    ignore: ['**/node_modules/**'], // Standard ignore
  };

  try {
    const pathsFromGlob = await deps.glob(globPattern, globOptions);
    const processingPromises = pathsFromGlob.map((entry) =>
      processGlobEntry({
        deps,
        entryPath: entry as string, // Assume string path from glob
        baseAbsolutePath: absolutePath,
        baseRelativePath: relativePath,
        includeStats,
      }),
    );

    const processedEntries = await Promise.all(processingPromises);
    for (const processed of processedEntries) {
      if (processed) {
        results.push(processed);
      }
    }
  } catch (globError: unknown) {
    const errorMessage = globError instanceof Error ? globError.message : String(globError);
    console.error(`[Filesystem MCP] Error during glob execution for ${absolutePath}:`, globError);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list files using glob: ${errorMessage}`,
      { cause: globError as Error }, // Keep as Error for now
    );
  }
  return results;
}

/** Handles the case where the input path is a directory. */
async function handleDirectoryCase(params: HandleDirectoryCaseParams): Promise<McpToolResponse> {
  const { deps, absolutePath, relativePath, recursive, includeStats } = params;
  let results: ProcessedEntry[];

  if (!recursive && !includeStats) {
    results = await listDirectoryNonRecursive(deps, absolutePath, relativePath);
  } else {
    results = await listDirectoryWithGlob({
      // Pass object
      deps,
      absolutePath,
      relativePath,
      recursive,
      includeStats,
    });
  }

  return formatResults(results, includeStats);
}

/** Processes the initial stats to determine if it's a file or directory. */
async function processInitialStats(params: ProcessInitialStatsParams): Promise<McpToolResponse> {
  const { deps, initialStats, relativeInputPath, targetAbsolutePath, recursive, includeStats } =
    params;

  if (initialStats.isFile()) {
    return handleFileCase(deps, relativeInputPath, targetAbsolutePath, initialStats);
  }

  if (initialStats.isDirectory()) {
    return await handleDirectoryCase({
      // Pass object
      deps,
      absolutePath: targetAbsolutePath,
      relativePath: relativeInputPath,
      recursive,
      includeStats,
    });
  }

  // Should not happen if stat succeeds, but handle defensively
  throw new McpError(
    ErrorCode.InternalError,
    `Path is neither a file nor a directory: ${relativeInputPath}`,
  );
}

/**
 * Main handler function for 'list_files' (Refactored).
 */
export const handleListFilesFunc = async (
  deps: ListFilesDependencies,
  args: unknown,
): Promise<McpToolResponse> => {
  // Remove unused variables from function scope
  const parsedArgs = parseAndValidateArgs(args);
  const { path: relativeInputPath, recursive, include_stats: includeStats } = parsedArgs;
  const targetAbsolutePath = deps.resolvePath(relativeInputPath);

  try {
    const initialStats = await deps.stat(targetAbsolutePath);
    // Delegate processing based on initial stats
    return await processInitialStats({
      deps,
      initialStats,
      relativeInputPath,
      targetAbsolutePath,
      recursive,
      includeStats,
    });
  } catch (error: unknown) {
    // Handle common errors like ENOENT
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Path not found: ${relativeInputPath}`,
        { cause: error instanceof Error ? error : undefined }, // Use safe cause
      );
    }
    // Re-throw known MCP errors
    if (error instanceof McpError) throw error;

    // Handle unexpected errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Filesystem MCP] Error in listFiles for ${targetAbsolutePath}:`, error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to process path: ${errorMessage}`,
      // Use cause directly if it's an Error, otherwise undefined
      { cause: error instanceof Error ? error : undefined },
    );
  }
};

// --- Tool Definition ---
const productionHandler = (args: unknown): Promise<McpToolResponse> => {
  // Provide more specific types for fsPromises functions
  const dependencies: ListFilesDependencies = {
    stat: fsPromises.stat,
    readdir: fsPromises.readdir as ListFilesDependencies['readdir'], // Assert correct type
    glob: globFn,
    resolvePath: resolvePathUtil,
    PROJECT_ROOT: projectRootUtil,
    formatStats: formatStatsUtil,
    path: {
      join: path.join.bind(path),
      dirname: path.dirname.bind(path),
      resolve: path.resolve.bind(path),
      relative: path.relative.bind(path),
      basename: path.basename.bind(path),
    },
  };
  return handleListFilesFunc(dependencies, args);
};

export const listFilesToolDefinition = {
  name: 'list_files',
  description: 'List files/directories. Can optionally include stats and list recursively.',
  inputSchema: ListFilesArgsSchema,
  handler: productionHandler,
};
