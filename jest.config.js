// jest.config.js
/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    // Use a pattern that includes .js files for ts-jest
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json', // Use test-specific tsconfig
      },
    ],
  },
  // Force transformation of fs/promises (and potentially other ESM deps)
  // This pattern ensures node_modules are generally ignored EXCEPT for fs/promises
  // Adjust if other ESM modules in node_modules need transformation
  transformIgnorePatterns: [
    '/node_modules/(?!fs/promises).+\\.js$', // Ignore node_modules JS except fs/promises
    '/node_modules/.+\\.(css|scss|sass|less|styl|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$' // Ignore common assets
  ],
  // Ignore utility files from being treated as test suites
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/__tests__/testUtils.ts',
  ],
};