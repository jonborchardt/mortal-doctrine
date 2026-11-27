import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

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
  {
    // Determinism guard. The simulation tsconfig already excludes DOM and Node types;
    // these catch nondeterministic sources that exist in plain ECMAScript.
    files: ['packages/simulation/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noDeepImports,
            noReact,
            { group: ['pixi.js', 'node:*'], message: 'Simulation must stay pure and headless.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Simulation must not read the system clock.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use a seeded RNG carried in state.' },
      ],
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  prettier,
);
