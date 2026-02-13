/**
 * check-non-versioned-mounts.js
 *
 * Fails when non-versioned API mounts are introduced in routes/index.js.
 * Canonical API mounts must use /api/v1.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_INDEX_PATH = path.join(__dirname, '../../routes/index.js');

const ALLOWED_NON_VERSIONED_MOUNTS = new Set([
  'app.use("/api", legacyApiDeprecationLogger, legacyApiDeprecationResponder);'
]);

function checkNonVersionedMounts() {
  const content = fs.readFileSync(ROUTES_INDEX_PATH, 'utf8');
  const lines = content.split('\n');

  const violations = [];

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith('app.use(')) {
      return;
    }

    const mountMatch = trimmedLine.match(/app\.use\(\s*["']([^"']+)["']/);
    if (!mountMatch) {
      return;
    }

    const mountPath = mountMatch[1];
    const isNonVersionedRoot = mountPath === '/';
    const isNonVersionedApi = mountPath === '/api' || /^\/api\/(?!v1\b)/.test(mountPath);

    if ((isNonVersionedRoot || isNonVersionedApi) && !ALLOWED_NON_VERSIONED_MOUNTS.has(trimmedLine)) {
      violations.push({ line: index + 1, statement: trimmedLine });
    }
  });

  if (violations.length > 0) {
    console.error('❌ Non-versioned API mounts detected in routes/index.js:');
    violations.forEach((violation) => {
      console.error(`  - Line ${violation.line}: ${violation.statement}`);
    });
    console.error('\nUse /api/v1/* mounts only. Legacy /api or / mounts must be explicit deprecation responders.');
    process.exit(1);
  }

  console.log('✅ No unauthorized non-versioned API mounts detected.');
}

checkNonVersionedMounts();
