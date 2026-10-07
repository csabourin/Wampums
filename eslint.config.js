/**
 * ESLint configuration for Wampums Scout Management System
 *
 * Enforces code quality standards and prevents common security issues.
 * Run with: npm run lint:eslint
 *
 * Existing errors are recorded in eslint-suppressions.json, so CI fails only on
 * new ones. After fixing suppressed errors, run `npm run lint:eslint:prune`.
 * The Expo app in mobile/ has its own toolchain and is not linted here.
 */

const js = require('@eslint/js');
const globals = require('globals');

const SERVER_FILES = [
  'api.js',
  'config/**/*.js',
  'middleware/**/*.js',
  'migrations/**/*.js',
  'routes/**/*.js',
  'scripts/**/*.js',
  'services/**/*.js',
  'utils/**/*.js',
];
const BROWSER_FILES = ['spa/**/*.js', 'src-sw.js', 'landing/**/*.js'];
// Shared with the SPA, which imports them as ES modules.
const SHARED_MODULE_FILES = ['config/meeting_sections.js', 'config/roles.js'];
const TEST_FILES = ['test/**/*.js', 'tests/**/*.js', '**/*.test.js', '**/*.spec.js', '**/__tests__/**/*.js'];

module.exports = [
  {
    ignores: [
      '.archive/**',
      '.claude/**',
      'attached_assets/**',
      'build/**',
      'coverage/**',
      'dist/**',
      'mobile/**',
      'node_modules/**',
      'public/build/**',
      '**/*.min.js',
    ],
  },

  js.configs.recommended,

  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // ============================================
      // CODE QUALITY
      // ============================================
      'eqeqeq': ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-eval': 'error',
      'no-with': 'error',
      'no-var': 'error',
      'prefer-const': 'warn',
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',

      // ============================================
      // SECURITY
      // ============================================
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',

      // ============================================
      // BEST PRACTICES
      // ============================================
      'default-case': 'warn',
      'no-eq-null': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'warn',
      'no-fallthrough': 'error',
      'no-magic-numbers': ['warn', {
        ignore: [0, 1, -1],
        ignoreArrayIndexes: true,
        enforceConst: true,
        detectObjects: false,
      }],
      'no-param-reassign': ['warn', { props: false }],
      'no-return-await': 'warn',
      'no-unused-expressions': 'error',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'consistent-return': 'warn',
      'curly': ['warn', 'all'],

      // ============================================
      // ASYNC/AWAIT
      // ============================================
      'require-await': 'warn',
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'warn',

      // ============================================
      // STYLE (warnings only)
      // ============================================
      'camelcase': ['warn', { properties: 'never', ignoreDestructuring: true }],
      'indent': ['warn', 2, { SwitchCase: 1 }],
      'linebreak-style': ['warn', 'unix'],
      'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'semi': ['warn', 'always'],
      'space-infix-ops': 'warn',
      'space-before-blocks': 'warn',
      'arrow-spacing': 'warn',
    },
  },

  // Backend: CommonJS on Node; console is the logging fallback.
  {
    files: SERVER_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    files: ['routes/**/*.js', 'middleware/**/*.js', 'services/**/*.js', 'scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['migrations/**/*.js', 'scripts/**/*.js'],
    rules: { 'no-console': 'off', 'no-magic-numbers': 'off' },
  },
  {
    files: ['config/**/*.js', '*.config.js', '*.config.mjs'],
    rules: { 'no-magic-numbers': 'off' },
  },

  // Web SPA and service worker: ES modules in the browser.
  {
    files: BROWSER_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
    },
  },

  {
    files: SHARED_MODULE_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {},
    },
  },

  // Tooling and scripts written as ES modules run on Node.
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // Tests mix require() and import (SPA tests go through Babel).
  {
    files: TEST_FILES,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.jest, ...globals.browser },
    },
    rules: {
      'no-magic-numbers': 'off',
      'no-console': 'off',
      // Tests feed javascript: URLs to the sanitizers on purpose.
      'no-script-url': 'off',
    },
  },
];
