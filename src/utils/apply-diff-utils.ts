// Barrel re-exporting the apply-diff utility surface.
// Implementation is split into cohesive modules:
//   - apply-diff-context.ts    (context/line formatting helper)
//   - apply-diff-validation.ts (diff block structure / line-number / content validation)
//   - apply-diff-apply.ts      (single-block application + multi-block orchestration)

export { getContextAroundLine } from './apply-diff-context.js';
export {
  hasValidDiffBlockStructure,
  hasValidLineNumberLogic,
  validateDiffBlock,
  validateLineNumbers,
  verifyContentMatch,
} from './apply-diff-validation.js';
export { applySingleValidDiff, applyDiffsToFileContent } from './apply-diff-apply.js';
