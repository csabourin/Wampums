#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SPA_ROOT = path.join(process.cwd(), 'spa');
const RULES = {
  console: {
    description: 'console usage found in SPA',
    pattern: /console\./,
    excludedFiles: new Set(['config.js', path.join('utils', 'DebugUtils.js')]),
  },
  innerhtml: {
    description: 'innerHTML assignment found in SPA',
    pattern: /innerHTML\s*=/,
    excludedFiles: new Set([
      path.join('utils', 'DOMUtils.js'),
      path.join('utils', 'SecurityUtils.js'),
    ]),
  },
};

/**
 * Recursively collect JavaScript source files without relying on external
 * executables that may be unavailable in CI or minimal developer images.
 *
 * @param {string} directory - Directory to scan
 * @returns {string[]} Absolute JavaScript file paths
 */
function collectJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectJavaScriptFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [absolutePath] : [];
  });
}

const ruleName = process.argv[2];
const rule = RULES[ruleName];

if (!rule) {
  process.stderr.write(`Unknown SPA source rule: ${ruleName || '(missing)'}\n`);
  process.exit(2);
}

if (!fs.existsSync(SPA_ROOT)) {
  process.stderr.write(`SPA source directory not found: ${SPA_ROOT}\n`);
  process.exit(2);
}

const violations = [];
for (const filePath of collectJavaScriptFiles(SPA_ROOT)) {
  const relativePath = path.relative(SPA_ROOT, filePath);
  if (rule.excludedFiles.has(relativePath)) {
    continue;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (rule.pattern.test(line)) {
      violations.push(`${path.join('spa', relativePath)}:${index + 1}:${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n${rule.description}\n`);
  process.exit(1);
}

process.stdout.write(`SPA ${ruleName} source check passed\n`);
