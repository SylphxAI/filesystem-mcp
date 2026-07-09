import type { ApplyDiffOutput, DiffApplyResult } from '../schemas/apply-diff-schema.js'
import { hashContent, recordWriteAudit, shouldUseRustAuditEngine } from '../engine/rust-audit.js'
import { applyDiffsToFileContent } from '../utils/apply-diff-utils.js'
import { formatFileProcessingError } from '../utils/error-utils.js'
import type { FileSystemDependencies } from './common.js'

type FileChange = {
	path: string
	expected_content_hash?: string | undefined
	diffs: {
		search: string
		replace: string
		start_line: number
		end_line: number
	}[]
}

export async function handleApplyDiffInternal(
	filePath: string,
	content: string,
	deps: FileSystemDependencies,
	auditContext?: {
		operationId: string
		beforeHash: string
		afterHash: string
		diffCount: number
	},
): Promise<ApplyDiffOutput> {
	const resolvedPath = deps.path.resolve(deps.projectRoot, filePath)

	try {
		await deps.writeFile(resolvedPath, content, 'utf8')
		return {
			success: true,
			operation_id: auditContext?.operationId,
			results: [
				{
					path: filePath,
					success: true,
					operation_id: auditContext?.operationId,
					before_hash: auditContext?.beforeHash,
					after_hash: auditContext?.afterHash,
					diff_count: auditContext?.diffCount,
				},
			],
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error
				? formatFileProcessingError(error, resolvedPath, filePath)
				: `Unknown error occurred while processing ${filePath}`

		return {
			success: false,
			operation_id: auditContext?.operationId,
			results: [
				{
					path: filePath,
					success: false,
					operation_id: auditContext?.operationId,
					before_hash: auditContext?.beforeHash,
					after_hash: auditContext?.afterHash,
					diff_count: auditContext?.diffCount,
					error: errorMessage,
					context: errorMessage.includes('ENOENT') ? 'File not found' : 'Error writing file',
				},
			],
		}
	}
}

async function applyDiffsToContent(
	originalContent: string,
	diffs: {
		search: string
		replace: string
		start_line: number
		end_line: number
	}[],
	_filePath: string,
): Promise<string> {
	const result = applyDiffsToFileContent(originalContent, diffs)
	if (!result.success) {
		throw new Error(result.error || 'Failed to apply diffs')
	}
	return result.newContent || originalContent
}

export async function handleApplyDiff(
	changes: FileChange[],
	deps: FileSystemDependencies,
): Promise<ApplyDiffOutput> {
	const results: DiffApplyResult[] = []
	const auditRecords: Array<{
		path: string
		before_hash: string
		after_hash: string
		diff_count: number
		success: boolean
		before_content?: string | undefined
	}> = []

	for (const change of changes) {
		const { path: filePath, diffs, expected_content_hash: expectedContentHash } = change
		const resolvedPath = deps.path.resolve(deps.projectRoot, filePath)

		try {
			const originalContent = await deps.readFile(resolvedPath, 'utf8')
			const beforeHash = hashContent(originalContent)

			if (expectedContentHash && expectedContentHash !== beforeHash) {
				results.push({
					path: filePath,
					success: false,
					before_hash: beforeHash,
					diff_count: diffs.length,
					error: 'Content hash conflict: file changed since the caller recorded expected_content_hash.',
					context: 'Re-read the file and retry with the current hash or without expected_content_hash.',
				})
				auditRecords.push({
					path: filePath,
					before_hash: beforeHash,
					after_hash: beforeHash,
					diff_count: diffs.length,
					success: false,
				})
				continue
			}

			const newContent = await applyDiffsToContent(originalContent, diffs, filePath)
			const afterHash = hashContent(newContent)
			const pendingResult = await handleApplyDiffInternal(filePath, newContent, deps, {
				operationId: '',
				beforeHash,
				afterHash,
				diffCount: diffs.length,
			})
			results.push(...pendingResult.results)
			auditRecords.push({
				path: filePath,
				before_hash: beforeHash,
				after_hash: afterHash,
				diff_count: diffs.length,
				success: pendingResult.success,
				before_content: originalContent,
			})
		} catch (error) {
			const errorMessage =
				error instanceof Error
					? formatFileProcessingError(error, resolvedPath, filePath)
					: `Unknown error occurred while processing ${filePath}`
			results.push({
				path: filePath,
				success: false,
				diff_count: diffs.length,
				error: errorMessage,
				context: errorMessage.includes('ENOENT') ? 'File not found' : 'Error applying diff',
			})
			auditRecords.push({
				path: filePath,
				before_hash: '',
				after_hash: '',
				diff_count: diffs.length,
				success: false,
			})
		}
	}

	const success = results.every((result) => result.success)
	let operationId: string | undefined
	let audit: ApplyDiffOutput['audit']

	if (shouldUseRustAuditEngine() && auditRecords.length > 0) {
		try {
			const recorded = recordWriteAudit(
				deps.projectRoot,
				'apply_diff',
				auditRecords.map((record) => ({
					path: record.path,
					beforeHash: record.before_hash,
					afterHash: record.after_hash,
					diffCount: record.diff_count,
					success: record.success,
					...(record.before_content !== undefined
						? { beforeContent: record.before_content }
						: {}),
				})),
			)
			operationId = recorded.operationId
			audit = {
				ledger_path: recorded.ledgerPath,
				records: recorded.records,
			}
			for (const result of results) {
				result.operation_id = operationId
				const ledgerRecord = recorded.records.find((entry) => entry.path === result.path)
				if (ledgerRecord?.rollback) {
					result.rollback = ledgerRecord.rollback
				}
			}
		} catch {
			// Audit failure should not hide write results; callers still get per-file hashes.
		}
	}

	return {
		success,
		operation_id: operationId,
		audit,
		results,
	}
}