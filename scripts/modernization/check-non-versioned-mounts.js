/**
 * check-non-versioned-mounts.js
 *
 * Fails when unauthorized non-versioned API mounts are introduced in routes/index.js.
 * Canonical API mounts should use /api/v1 unless a router contains legacy absolute paths.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_INDEX_PATH = path.join(__dirname, '../../routes/index.js');

const ALLOWED_NON_VERSIONED_MOUNTS = new Set([
  'app.use("/", authRoutes);',
  'app.use("/", rolesRoutes);',
  'app.use("/api", announcementsRoutes);',
  'app.use("/api", honorsRoutes);',
  'app.use("/api", financeRoutes);',
  'app.use("/api", stripeRoutes);',
  'app.use("/api", budgetsRoutes);',
  'app.use("/api", externalRevenueRoutes);',
  'app.use("/api", medicationRoutes);',
  'app.use("/api", whatsappBaileysRoutes);',
  'app.use("/api", legacyApiDeprecationLogger, legacyApiDeprecationResponder);'
]);

const REQUIRED_MOUNTS = new Map([
  ['authRoutes', '/'],
  ['rolesRoutes', '/'],
  ['whatsappBaileysRoutes', '/api']
]);

function parseMount(trimmedLine) {
  const match = trimmedLine.match(/app\.use\(\s*["']([^"']+)["']\s*,\s*([^,)]+)/);
  if (!match) {
    return null;
  }

  return {
    mountPath: match[1],
    target: match[2].trim()
  };
}

function checkNonVersionedMounts() {
  const content = fs.readFileSync(ROUTES_INDEX_PATH, 'utf8');
  const lines = content.split('\n');

  const violations = [];
  const seenMounts = new Map();

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith('app.use(')) {
      return;
    }

    const parsed = parseMount(trimmedLine);
    if (!parsed) {
      return;
    }

    const { mountPath, target } = parsed;
    seenMounts.set(target, mountPath);

    const isNonVersionedRoot = mountPath === '/';
    const isNonVersionedApi = mountPath === '/api' || /^\/api\/(?!v1\b)/.test(mountPath);

    if ((isNonVersionedRoot || isNonVersionedApi) && !ALLOWED_NON_VERSIONED_MOUNTS.has(trimmedLine)) {
      violations.push({ line: index + 1, statement: trimmedLine });
    }
  });

  REQUIRED_MOUNTS.forEach((expectedMount, routerName) => {
    const actualMount = seenMounts.get(routerName);
    if (actualMount !== expectedMount) {
      violations.push({
        line: '-',
        statement: `Expected ${routerName} to be mounted at ${expectedMount}, found ${actualMount || 'missing mount'}`
      });
    }
  });

  if (violations.length > 0) {
    console.error('❌ Non-versioned mount policy violations detected in routes/index.js:');
    violations.forEach((violation) => {
      console.error(`  - Line ${violation.line}: ${violation.statement}`);
    });
    console.error('\nUse /api/v1/* mounts by default. Non-versioned mounts must be explicit and justified.');
    process.exit(1);
  }

  console.log('✅ Mount policy checks passed.');
}

checkNonVersionedMounts();
