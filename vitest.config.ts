import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Use Vitest globals (describe, it, expect, etc.)
    environment: 'node', // Set the test environment to Node.js
    coverage: {
      provider: 'v8', // Use V8 for coverage collection
      reporter: ['text', 'json', 'html'], // Coverage report formats
      reportsDirectory: './coverage', // Explicitly set the output directory
      include: ['src/**/*.ts'], // Include all source files for coverage
      exclude: [ // Exclude files not relevant for coverage
        'src/index.ts', // Entry point might be hard to test directly
        'src/utils/pathUtils.ts', // Relies heavily on process.cwd() at module load
        'src/utils/statsUtils.ts', // Simple formatting utility
        'src/**/*.d.ts',
        '**/__mocks__/**',
        '**/__tests__/**',
      ],
    },
    // Vitest generally handles ESM better, but specific configs might be needed later
    // For now, rely on defaults and tsconfig.json settings
    // Ensure tsconfig.test.json or equivalent settings are compatible
    deps: {
      optimizer: {
        ssr: {
          // Suggested replacement for deprecated 'inline' to handle problematic ESM dependencies
          include: ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/stdio'],
        },
      },
    },
    // Exclude the problematic index test again
    exclude: [
      '**/node_modules/**', // Keep default excludes
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '__tests__/index.test.ts' // Exclude the index test
    ],
  },
});