import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
// import unicornPlugin from "eslint-plugin-unicorn"; // Keep commented out for now
// import importPlugin from "eslint-plugin-import"; // Keep commented out for now
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "coverage/",
      "docs/.vitepress/dist/",
      "docs/.vitepress/cache/",
    ],
  },

  // Apply recommended rules globally
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // ...tseslint.configs.recommendedTypeChecked, // Enable later if needed

  // Configuration for SOURCE TypeScript files (requiring type info)
  {
    files: ["src/**/*.ts"], // Apply project-specific parsing only to src files
    languageOptions: {
      parserOptions: {
        project: true, // Enable project-based parsing ONLY for src files
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Add specific rules for source TS if needed
    },
  },

  // Configuration for OTHER TypeScript files (tests, configs - NO type info needed)
  {
    files: ["__tests__/**/*.ts", "*.config.ts", "*.config.js"], // Include JS configs here too
    languageOptions: {
      parserOptions: {
        project: null, // Explicitly disable project-based parsing for these files
      },
      globals: {
        ...globals.node,
        // Removed ...globals.vitest
      },
    },
    rules: {
      // Relax rules if needed for tests/configs, e.g., allow console in tests
      "no-console": "off", // Allow console.log in tests and configs
      "@typescript-eslint/no-explicit-any": "off", // Allow 'any' in test files
      // Potentially disable rules that rely on type info if they cause issues
      // "@typescript-eslint/no-unsafe-assignment": "off",
      // "@typescript-eslint/no-unsafe-call": "off",
      // "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },

  // Configuration for OTHER JavaScript files (if any)
  // Note: *.config.js is handled above now. Keep this for other potential JS files.
  {
    files: ["**/*.js", "**/*.cjs"],
    ignores: ["*.config.js"], // Ignore config files already handled
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Add specific rules for other JS if needed
    },
  },

  // Apply Prettier config last to override other formatting rules
  prettierConfig,

  // Add other plugins/configs as needed
  // Example: Unicorn plugin (ensure installed)
  /*
  {
    plugins: {
      unicorn: unicornPlugin,
    },
    rules: {
      ...unicornPlugin.configs.recommended.rules,
      // Override specific unicorn rules if needed
    },
  },
  */

  // Example: Import plugin (ensure installed and configured)
  /*
  {
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      }
    },
    rules: {
       // Add import rules
       'import/no-unresolved': 'error', // Re-enable this later
    }
  }
  */
);
