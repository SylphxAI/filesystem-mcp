import type { ApplyDiffOutput, DiffApplyResult } from '../schemas/apply-diff-schema.js';
import { formatFileProcessingError } from '../utils/error-utils.js';
import { applyDiffsToFileContent } from '../utils/apply-diff-utils.js';
import type { FileSystemDependencies } from './common.js';

export async function handleApplyDiffInternal(
  filePath: string,
  content: string,
  deps: FileSystemDependencies,
): Promise<ApplyDiffOutput> {
  const resolvedPath = deps.path.resolve(deps.projectRoot, filePath);

  try {
    await deps.writeFile(resolvedPath, content, 'utf8'); // Use utf-8
    return {
      success: true,
      results: [
        {
          path: filePath,
          success: true,
        },
      ],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? formatFileProcessingError(error, resolvedPath, filePath, deps.projectRoot)
        : `Unknown error occurred while processing ${filePath}`;

    return {
      success: false,
      results: [
        {
          path: filePath,
          success: false,
          error: errorMessage,
          context: errorMessage.includes('ENOENT') ? 'File not found' : 'Error writing file',
        },
      ],
    };
  }
}

async function applyDiffsToContent(
  originalContent: string,
  diffs: {
    search: string;
    replace: string;
    start_line: number;
    end_line: number;
  }[],
  filePath: string,
): Promise<string> {
  const result = applyDiffsToFileContent(originalContent, diffs, filePath);
  if (!result.success) {
    throw new Error(result.error || 'Failed to apply diffs');
  }
  return result.newContent || originalContent;
}

export async function handleApplyDiff(
  changes: {
    path: string;
    diffs: {
      search: string;
      replace: string;
      start_line: number;
      end_line: number;
    }[];
  }[],
  deps: FileSystemDependencies,
): Promise<ApplyDiffOutput> {
  const results: DiffApplyResult[] = [];

  for (const change of changes) {
    const { path: filePath, diffs } = change;
    const originalContent = await deps.readFile(
      deps.path.resolve(deps.projectRoot, filePath),
      'utf8',
    );
    const newContent = await applyDiffsToContent(originalContent, diffs, filePath);
    const result = await handleApplyDiffInternal(filePath, newContent, deps);
    results.push(...result.results);
  }

  return {
    success: results.every((r) => r.success),
    results,
  };
}
