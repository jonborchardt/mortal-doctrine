import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { determinismLintConfig, loadWorkspace } from './scripts/check-boundaries.ts';

// Packages expose only declared entry points (root, plus `/testing` for fixtures).
const noDeepImports = {
  group: ['@mortal-doctrine/*/*', '!@mortal-doctrine/*/testing'],
  message: 'Import a declared entry point; deep imports bypass the public API.',
};

// React belongs to apps only. Packages must stay framework-agnostic.
const noReact = {
  group: ['react', 'react-dom', 'react-dom/*'],
  message: 'React is only allowed in apps/.',
};

export default defineConfig(
  globalIgnores(['**/dist/', '**/node_modules/', 'test-results/', 'playwright-report/']),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: [noDeepImports] }],
      // scripts/check-boundaries.ts finds imports by scanning source text, so specifiers must
      // be visible literals. Replace with module-graph analysis if this ever becomes limiting.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.type!="Literal"]',
          message: 'Use a string-literal specifier; computed imports evade boundary checks.',
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['packages/**', 'characters/**', 'arenas/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noDeepImports, noReact] }],
    },
  },
  // Determinism guard for every package whose declared layer is foundation, simulation or
  // animation (derived from package.json, so new packages need no edit here). Their tsconfig
  // checks (no DOM lib, no ambient types) live in the boundary checker.
  determinismLintConfig(loadWorkspace(import.meta.dirname), [noDeepImports]),
  {
    files: ['apps/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  prettier,
);
