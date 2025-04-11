import { z } from 'zod';

// Schema for a single diff block
const diffBlockSchema = z
  .object({
    search: z.string().describe('Exact content to find, including whitespace and newlines.'),
    replace: z.string().describe('Content to replace the search block with.'),
    start_line: z
      .number()
      .int()
      .min(1)
      .describe('The 1-based line number where the search block starts.'),
    end_line: z
      .number()
      .int()
      .min(1)
      .describe('The 1-based line number where the search block ends.'),
    operation: z
      .enum(['insert', 'replace'])
      .default('replace')
      .optional()
      .describe('Type of operation - insert or replace content'),
  })
  .describe('A single search/replace operation within a file.');

// Ensure valid line numbers based on operation type
const refinedDiffBlockSchema = diffBlockSchema.refine(
  (data) => {
    if (data.operation === 'insert') {
      return data.end_line >= data.start_line - 1;
    }
    return data.end_line >= data.start_line;
  },
  {
    message: 'Invalid line numbers for operation type',
    path: ['end_line'],
  },
);

// Schema for changes to a single file
const fileDiffSchema = z.object({
  path: z.string().min(1).describe('Relative path to the file to modify.'),
  diffs: z
    .array(refinedDiffBlockSchema)
    .min(1)
    .describe('Array of diff blocks to apply to this file.'),
});

// Main input schema for the apply_diff tool
export const applyDiffInputSchema = z.object({
  changes: z
    .array(fileDiffSchema)
    .min(1)
    .describe('An array of file modification requests.')
    // Ensure each path appears only once
    .refine(
      (changes) => {
        const paths = changes.map((c) => c.path);
        return new Set(paths).size === paths.length;
      },
      {
        message: 'Each file path must appear only once in a single request.',
        path: ['changes'], // Attach error to the main changes array
      },
    ),
});

export type ApplyDiffInput = z.infer<typeof applyDiffInputSchema>;
export type FileDiff = z.infer<typeof fileDiffSchema>;
export type DiffBlock = z.infer<typeof refinedDiffBlockSchema>;

// Schema for individual diff operation result
export const diffResultSchema = z.object({
  operation: z.enum(['insert', 'replace']),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  success: z.boolean(),
  error: z.string().optional(),
  context: z.string().optional(),
});

export type DiffResult = z.infer<typeof diffResultSchema>;

// Define potential output structure
const diffApplyResultSchema = z.object({
  path: z.string(),
  success: z.boolean(),
  error: z.string().optional().describe('Detailed error message if success is false.'),
  context: z.string().optional().describe('Lines around the error location if success is false.'),
  diffResults: z.array(diffResultSchema).optional(),
});

export const applyDiffOutputSchema = z.object({
  success: z.boolean().describe('True if all operations succeeded.'),
  results: z.array(diffApplyResultSchema).describe('Results for each file processed.'),
});

export type ApplyDiffOutput = z.infer<typeof applyDiffOutputSchema>;
export type DiffApplyResult = z.infer<typeof diffApplyResultSchema>;
