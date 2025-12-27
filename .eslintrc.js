/**
 * ESLint Configuration for Wampums Scout Management System
 *
 * Enforces code quality standards and prevents common security issues.
 * Run with: npx eslint spa/**/*.js routes/**/*.js
 */

module.exports = {
  env: {
    browser: true,
    node: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // ============================================
    // CODE QUALITY
    // ============================================

    // Enforce === and !== instead of == and !=
    'eqeqeq': ['error', 'always'],

    // Disallow console (warn only, allow console.warn and console.error for emergencies)
    'no-console': ['warn', {
      allow: ['warn', 'error']
    }],

    // Disallow eval()
    'no-eval': 'error',

    // Disallow with statements
    'no-with': 'error',

    // Require let or const instead of var
    'no-var': 'error',

    // Prefer const over let when variable is never reassigned
    'prefer-const': 'warn',

    // Require arrow functions for callbacks
    'prefer-arrow-callback': 'warn',

    // Require template literals instead of string concatenation
    'prefer-template': 'warn',

    // ============================================
    // SECURITY
    // ============================================

    // No implied eval
    'no-implied-eval': 'error',

    // No new Function
    'no-new-func': 'error',

    // No script URLs
    'no-script-url': 'error',

    // ============================================
    // BEST PRACTICES
    // ============================================

    // Require default case in switch statements
    'default-case': 'warn',

    // Require === null instead of == null
    'no-eq-null': 'error',

    // Disallow extending native types
    'no-extend-native': 'error',

    // Disallow unnecessary function binding
    'no-extra-bind': 'warn',

    // Disallow fallthrough in switch statements
    'no-fallthrough': 'error',

    // Disallow floating decimals
    'no-floating-decimal': 'warn',

    // Disallow magic numbers (warn only)
    'no-magic-numbers': ['warn', {
      ignore: [0, 1, -1],
      ignoreArrayIndexes: true,
      enforceConst: true,
      detectObjects: false,
    }],

    // Disallow multiple spaces
    'no-multi-spaces': 'warn',

    // Disallow reassigning function parameters
    'no-param-reassign': ['warn', {
      props: false,
    }],

    // Disallow unnecessary return await
    'no-return-await': 'warn',

    // Disallow unused expressions
    'no-unused-expressions': 'error',

    // Disallow unused variables
    'no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    }],

    // Require consistent return
    'consistent-return': 'warn',

    // Require curly braces for all control statements
    'curly': ['warn', 'all'],

    // ============================================
    // ASYNC/AWAIT
    // ============================================

    // Require await in async functions
    'require-await': 'warn',

    // Disallow async functions with no await
    'no-async-promise-executor': 'error',

    // Require await in loops
    'no-await-in-loop': 'warn',

    // ============================================
    // STYLE (Warnings only)
    // ============================================

    // Require camelCase naming
    'camelcase': ['warn', {
      properties: 'never',
      ignoreDestructuring: true,
    }],

    // Require consistent spacing
    'indent': ['warn', 2, {
      SwitchCase: 1,
    }],

    // Require consistent line breaks
    'linebreak-style': ['warn', 'unix'],

    // Require consistent quotes
    'quotes': ['warn', 'single', {
      avoidEscape: true,
      allowTemplateLiterals: true,
    }],

    // Require semicolons
    'semi': ['warn', 'always'],

    // Require consistent spacing around operators
    'space-infix-ops': 'warn',

    // Require space before blocks
    'space-before-blocks': 'warn',

    // Require consistent arrow function spacing
    'arrow-spacing': 'warn',
  },

  // ============================================
  // OVERRIDES FOR SPECIFIC FILE TYPES
  // ============================================
  overrides: [
    // Backend routes can use console for logging
    {
      files: ['routes/**/*.js', 'middleware/**/*.js', 'services/**/*.js', 'scripts/**/*.js'],
      rules: {
        'no-console': 'off',
      },
    },

    // Test files can have more relaxed rules
    {
      files: ['**/*.test.js', '**/*.spec.js', '**/__tests__/**/*.js'],
      env: {
        jest: true,
      },
      rules: {
        'no-magic-numbers': 'off',
        'no-console': 'off',
      },
    },

    // Migration scripts can use console
    {
      files: ['migrations/**/*.js', 'scripts/**/*.js'],
      rules: {
        'no-console': 'off',
        'no-magic-numbers': 'off',
      },
    },

    // Config files can have relaxed rules
    {
      files: ['*.config.js', 'config/**/*.js'],
      rules: {
        'no-magic-numbers': 'off',
      },
    },
  ],

  // Ignore patterns
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '*.min.js',
    'public/build/',
    'coverage/',
  ],
};
