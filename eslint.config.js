// eslint.config.js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'; // Includes config and plugin

export default tseslint.config(
  // 1. Global ignores
  {
    ignores: [
      'node_modules',
      'dist', // Updated outDir
      'coverage',
      'docs/.vitepress/dist',
      'docs/.vitepress/cache',
      'build', // Explicitly ignore old build directory if it exists
    ],
  },

  // 2. Base JS recommended rules (applied globally)
  eslint.configs.recommended,

  // 3. Base TS recommended rules + General Overrides (applied globally to TS/JS)
  // Apply basic TS rules globally, but NOT ones requiring type info
  {
    files: ['**/*.{js,ts}'],
    extends: [tseslint.configs.recommended], // Base TS rules
    rules: {
      // General JS/TS Rules (Matching Guideline)
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-unused-vars': 'off', // Use TS version
      complexity: ['error', { max: 10 }],
      'max-lines': [
        'warn',
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'warn',
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
      'max-depth': ['warn', 3],
      'max-params': ['warn', 4],

      // TypeScript Specific Rules (Apply only non-type-aware rules globally)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-use-before-define': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Moved prefer-readonly, no-floating-promises, no-misused-promises to the type-aware block below
    },
  },

  // 4. Strict TYPE-AWARE rules ONLY for src files
  {
    files: ['src/**/*.ts'], // Target only src files
    extends: [
      // Apply type-aware extends HERE
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      // Keep parser options here
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Add type-aware rules HERE
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/prefer-readonly': 'warn', // Moved from global
      // Add other type-aware rules from guideline if needed
    },
  },

  // 5. Prettier integration (must be last among rule configs)
  eslintPluginPrettierRecommended,

  // 6. Overrides for specific files (config, tests) - AFTER Prettier
  {
    files: [
      '*.config.js',
      '*.config.ts',
      '.*rc.js',
      '*.config.cjs',
      '.*rc.cjs',
      'scripts/**/*.js',
      'scripts/**/*.mjs',
    ],
    rules: {
      'max-lines': 'off',
      '@typescript-eslint/no-explicit-any': 'off', // Relax rules for config files
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-var-requires': 'off', // Allow require in CJS config files
      // Ensure type-aware rules are off if they cause issues
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/prefer-readonly': 'off', // Turn off type-aware rule here
    },
  },
  {
    files: ['__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'off', // Disable for tests due to import() types
      // Disable type-aware rules explicitly for tests
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/prefer-readonly': 'off', // Turn off type-aware rule here
    },
  },
);
