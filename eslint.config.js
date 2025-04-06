// eslint.config.js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  // 1. Global ignores
  {
    ignores: [
      'node_modules',
      'build',
      'dist',
      'coverage',
      'docs/.vitepress/dist',
      'docs/.vitepress/cache',
    ],
  },

  // 2. Base JS recommended rules (applied globally)
  eslint.configs.recommended,

  // 3. Base TS recommended rules + General Overrides (applied to all TS/JS files)
  {
    files: ['**/*.{js,ts}'],
    extends: [tseslint.configs.recommended], // Apply base TS recommended rules
    rules: {
      // --- General JS/TS Rules ---
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-unused-vars': 'off', // Let TS handle this
      complexity: ['warn', { max: 15 }],
      'max-lines': [
        'warn',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'warn',
        { max: 70, skipBlankLines: true, skipComments: true },
      ],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],

      // --- Basic TypeScript Specific Rules (overrides if needed) ---
      // Use 'warn' for some rules globally, stricter 'error' applied only for 'src' below
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-use-before-define': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // 4. Strict type-checked rules ONLY for src files
  {
    files: ['src/**/*.ts'],
    // Apply strict and stylistic configs for type-aware linting
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Rules requiring type information (for src files) ---
      // Re-enable stricter rules for src, overriding the warnings from the global config
      '@typescript-eslint/no-explicit-any': ['error', { ignoreRestArgs: true }],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Type-aware rules
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/prefer-readonly': 'warn',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/unbound-method': 'warn',
    },
  },

  // 5. Overrides for specific file types (config, tests, scripts)
  {
    files: [
      '*.config.{js,ts,cjs,mjs}',
      '.*rc.{js,cjs}',
      'scripts/**/*.{js,mjs}', // Apply to scripts as well
    ],
    languageOptions: {
      globals: {
        // Define Node.js globals explicitly
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly', // Add console
      },
    },
    // No 'extends' here, just specific rule overrides
    rules: {
      'max-lines': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-var-requires': 'off', // Keep allowing require
      'no-undef': 'error', // Keep no-undef enabled
      // Disable type-aware rules explicitly as they shouldn't run here anyway
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    files: ['__tests__/**/*.ts'],
    // No 'extends' here, just specific rule overrides
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'off', // Disable for tests due to import() types
      // Disable type-aware rules explicitly
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // 6. Prettier integration (must be last)
  // eslintPluginPrettierRecommended is itself a config object, so it's placed directly
  eslintPluginPrettierRecommended,
);
