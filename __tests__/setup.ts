// Module mapping for tests to load correct compiled files
import { vi } from 'vitest';
import path from 'node:path';

// Setup module aliases to redirect imports to the compiled code
const srcToDistMap = new Map<string, string>();

// Map all src module paths to their compiled versions
function mapSourceToCompiledModule(id: string) {
  // Convert import paths from src to dist
  const sourcePattern = /^\.\.\/\.\.\/src\/(.+)$/;

  // Check for TypeScript module imports
  if (id.endsWith('.ts')) {
    const match = id.match(sourcePattern);
    if (match) {
      const relativePath = match[1];
      // Remove .ts extension if present
      const basePath = relativePath.endsWith('.ts') ? relativePath.slice(0, -3) : relativePath;

      return `${path.resolve(__dirname, '../dist', basePath)}`;
    }
  }

  // Check for JavaScript module imports
  if (id.endsWith('.js')) {
    const match = id.match(sourcePattern);
    if (match) {
      const relativePath = match[1];
      const basePath = relativePath.endsWith('.js') ? relativePath.slice(0, -3) : relativePath;

      return `${path.resolve(__dirname, '../dist', basePath)}.js`;
    }
  }

  // If no match, return the original id
  return id;
}

// Register module mock
vi.mock(/^\.\.\/\.\.\/src\/(.+)$/, (importOriginal) => {
  const origPath = importOriginal as string;
  const compiledPath = mapSourceToCompiledModule(origPath);

  if (compiledPath !== origPath) {
    srcToDistMap.set(origPath, compiledPath);
    return vi.importActual(compiledPath);
  }

  // Fallback to the original import for non-mapped paths
  return vi.importActual(origPath);
});

// Debug log - will be visible during test run
console.log('Test setup: Module aliases configured for src to dist mapping');
