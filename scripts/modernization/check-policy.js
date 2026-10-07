#!/usr/bin/env node
/**
 * check-policy.js
 *
 * Enforces CLAUDE.md rules that the other modernization checks do not cover,
 * as a ratchet: violations that already exist are recorded per file in
 * policy-baseline.json, and a file may never gain one. When a file loses one,
 * the baseline must be lowered in the same change, so the debt only shrinks.
 *
 *   node scripts/modernization/check-policy.js [rule ...]       check (all rules by default)
 *
 * Rules: role-names, client-org-id, manual-auth, catch-shadow (source patterns),
 * and eslint-warnings (ESLint warnings, which ESLint's own suppressions do not cover).
 *   node scripts/modernization/check-policy.js --update-baseline record lower counts
 *
 * A line that legitimately matches a rule is annotated instead of baselined,
 * on that line or the line above, with a reason:
 *
 *   // policy-allow role-names: demo accounts are described by role (CLAUDE.md §3)
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const BASELINE_PATH = process.env.POLICY_BASELINE_PATH || path.join(__dirname, 'policy-baseline.json');
const SERVER_ROOTS = ['api.js', 'config', 'middleware', 'routes', 'services', 'utils'];

/**
 * Patterns are tested per line; comment-only lines are skipped. A rule may
 * instead provide `scan(source)` returning the 1-based lines that violate it.
 */
const RULES = {
  'role-names': {
    description: 'Access decided by a role name instead of a permission or data_scope',
    guidance: 'Use requirePermission / req.userPermissions, or getUserDataScope for whole-unit vs own-children.',
    scopes: [
      {
        roots: SERVER_ROOTS,
        patterns: [
          /\broleNames\??\.(includes|some|indexOf|find)\(/,
          /\brole_name\s*(={1,3}|!==?|<>)\s*['"]/,
          /\brole_name\s+(NOT\s+)?IN\s*\(\s*'/i,
          /\broleName\s*[!=]==?\s*['"]/,
          /\.role\s*[!=]==?\s*['"]/,
          /(?<!function\s)\bhasRole\(/,
        ],
      },
      {
        roots: ['spa', path.join('mobile', 'src')],
        exclude: [path.join('spa', 'utils', 'PermissionUtils.js'), path.join('mobile', 'src', 'utils', 'PermissionUtils.js')],
        patterns: [/(?<!function\s)\bhasRole\(\s*['"]/],
      },
    ],
  },
  'client-org-id': {
    description: 'Organization ID taken from the client outside the organization resolvers',
    guidance: 'Use getOrganizationId(req, pool); the JWT organization always wins for signed-in users.',
    scopes: [
      {
        roots: SERVER_ROOTS,
        exclude: [path.join('middleware', 'auth.js'), path.join('utils', 'api-helpers.js')],
        patterns: [
          /\breq\.(query|body|params)\??\.(organization_id|organizationId)\b/,
          /x-organization-id/i,
        ],
      },
    ],
  },
  'manual-auth': {
    description: 'Hand-rolled authentication or authorization in a route',
    guidance: 'Use authenticate, blockDemoRoles and requirePermission from middleware/auth.js, with getOrganizationId.',
    scopes: [
      {
        roots: ['routes'],
        patterns: [
          /\bverifyJWT(Token)?\(/,
          /\bjwt\.verify\(/,
          /\bverifyOrganizationMembership\(/,
          /\bgetCurrentOrganizationId\(/,
        ],
      },
    ],
  },
  'eslint-warnings': {
    description: 'New ESLint warnings (CLAUDE.md §10: warnings must be resolved before merge)',
    guidance: 'Fix them (npx eslint <file>); a false positive gets // eslint-disable-next-line <rule> -- <reason>.',
    annotatable: false,
    collect: collectEslintWarnings,
  },
  'catch-shadow': {
    description: 'catch (error) hides the error() response helper, so error(res, ...) throws',
    guidance: 'Name the caught value err.',
    scopes: [
      {
        roots: SERVER_ROOTS,
        scan: findShadowedErrorHelperCalls,
      },
    ],
  },
};

const ALLOW_PATTERN = /policy-allow\s+([\w-]+(?:\s*,\s*[\w-]+)*)\s*:\s*\S/;
const COMMENT_ONLY_LINE = /^\s*(\/\/|\/\*|\*)/;

/**
 * @param {string} relativeRoot - File or directory relative to the repository root
 * @returns {string[]} Repository-relative JavaScript file paths
 */
function collectFiles(relativeRoot) {
  const absolute = path.join(ROOT, relativeRoot);
  if (!fs.existsSync(absolute)) {
    return [];
  }
  if (fs.statSync(absolute).isFile()) {
    return relativeRoot.endsWith('.js') ? [relativeRoot] : [];
  }
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      return [];
    }
    const child = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(child);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [child] : [];
  });
}

/**
 * Lines inside `catch (error) { ... }` that call error(res, ...) in a file where
 * `error` is the response helper.
 *
 * @param {string} source - File contents
 * @returns {number[]} 1-based line numbers
 */
function findShadowedErrorHelperCalls(source) {
  const importsHelper = /\{[^}]*\berror\b[^}]*\}\s*=\s*require\(\s*['"][^'"]*response['"]\s*\)/.test(source)
    || /import\s*\{[^}]*\berror\b[^}]*\}\s*from\s*['"][^'"]*response(\.js)?['"]/.test(source);
  if (!importsHelper) {
    return [];
  }

  const lines = source.split('\n');
  const offsets = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const lineAt = (index) => {
    let low = 0;
    let high = offsets.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (offsets[mid] <= index) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low + 1;
  };

  const found = new Set();
  const catchPattern = /catch\s*\(\s*error\s*\)\s*\{/g;
  let match;
  while ((match = catchPattern.exec(source)) !== null) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < source.length) {
      if (source[end] === '{') {
        depth += 1;
      } else if (source[end] === '}') {
        depth -= 1;
      }
      end += 1;
    }
    const body = source.slice(match.index + match[0].length, end);
    const callPattern = /(^|[^.\w])error\(\s*res\b/g;
    let call;
    while ((call = callPattern.exec(body)) !== null) {
      found.add(lineAt(match.index + match[0].length + call.index + call[1].length));
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * @param {string[]} lines - File lines
 * @param {number} index - 0-based line index
 * @param {string} ruleName - Rule being checked
 * @returns {boolean} Whether the line or the one above carries a policy-allow for the rule
 */
function isAllowed(lines, index, ruleName) {
  return [lines[index], lines[index - 1]].some((line) => {
    const allow = line && ALLOW_PATTERN.exec(line);
    return Boolean(allow) && allow[1].split(',').map((name) => name.trim()).includes(ruleName);
  });
}

/**
 * ESLint warnings per file. Errors are enforced separately by `npm run lint:eslint`
 * against eslint-suppressions.json; ESLint has no equivalent for warnings.
 *
 * @returns {Promise<Map<string, string[]>>} file -> warning descriptions
 */
async function collectEslintWarnings() {
  const { ESLint } = require('eslint');
  const eslint = new ESLint({ cwd: ROOT });
  const results = await eslint.lintFiles(['.']);
  const violations = new Map();
  for (const result of results) {
    const file = path.relative(ROOT, result.filePath);
    const warnings = result.messages
      .filter((message) => message.severity === 1)
      .map((message) => `${file}:${message.line}: ${message.message} [${message.ruleId}]`);
    if (warnings.length > 0) {
      violations.set(file, warnings);
    }
  }
  return violations;
}

/**
 * @param {string} ruleName - Key of RULES
 * @returns {Map<string, string[]>|Promise<Map<string, string[]>>} file -> violation descriptions
 */
function findViolations(ruleName) {
  if (RULES[ruleName].collect) {
    return RULES[ruleName].collect();
  }
  const violations = new Map();
  for (const scope of RULES[ruleName].scopes) {
    const excluded = new Set(scope.exclude || []);
    for (const file of scope.roots.flatMap(collectFiles)) {
      if (excluded.has(file)) {
        continue;
      }
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const lines = source.split('\n');
      const hits = scope.scan
        ? scope.scan(source).map((lineNumber) => lineNumber - 1)
        : lines.flatMap((line, index) => (
          !COMMENT_ONLY_LINE.test(line) && scope.patterns.some((pattern) => pattern.test(line)) ? [index] : []
        ));
      const reported = hits
        .filter((index) => !isAllowed(lines, index, ruleName))
        .map((index) => `${file}:${index + 1}: ${lines[index].trim()}`);
      if (reported.length > 0) {
        violations.set(file, [...(violations.get(file) || []), ...reported]);
      }
    }
  }
  return violations;
}

function readBaseline() {
  return fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) : {};
}

function writeBaseline(baseline) {
  const sorted = Object.fromEntries(Object.keys(baseline).sort().map((ruleName) => [
    ruleName,
    Object.fromEntries(Object.keys(baseline[ruleName]).sort().map((file) => [file, baseline[ruleName][file]])),
  ]));
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');
  const requested = args.filter((arg) => !arg.startsWith('--'));
  const unknown = requested.filter((ruleName) => !RULES[ruleName]);
  if (unknown.length > 0) {
    process.stderr.write(`Unknown policy rule: ${unknown.join(', ')}. Known: ${Object.keys(RULES).join(', ')}\n`);
    process.exit(2);
  }
  const ruleNames = requested.length > 0 ? requested : Object.keys(RULES);

  const baseline = readBaseline();
  let failed = false;

  for (const ruleName of ruleNames) {
    const rule = RULES[ruleName];
    // eslint-disable-next-line no-await-in-loop -- rules report in order; ESLint dominates the run anyway
    const violations = await findViolations(ruleName);
    const recorded = baseline[ruleName];
    const allowed = recorded || {};
    const grown = [];
    const shrunk = [];

    for (const file of new Set([...violations.keys(), ...Object.keys(allowed)])) {
      const count = (violations.get(file) || []).length;
      const limit = allowed[file] || 0;
      if (count > limit) {
        grown.push({ file, count, limit });
      } else if (count < limit) {
        shrunk.push({ file, count, limit });
      }
    }

    if (updateBaseline) {
      if (recorded && grown.length > 0) {
        process.stderr.write(`[${ruleName}] Refusing to raise the baseline; fix or annotate these instead:\n`);
        grown.forEach(({ file }) => process.stderr.write(`${violations.get(file).join('\n')}\n`));
        failed = true;
        continue;
      }
      baseline[ruleName] = Object.fromEntries([...violations].map(([file, lines]) => [file, lines.length]));
      const total = Object.values(baseline[ruleName]).reduce((sum, count) => sum + count, 0);
      process.stdout.write(`[${ruleName}] baseline recorded: ${total} existing violation(s)\n`);
      continue;
    }

    if (grown.length > 0) {
      failed = true;
      process.stderr.write(`❌ [${ruleName}] ${rule.description}.\n   ${rule.guidance}\n`);
      for (const { file, count, limit } of grown) {
        process.stderr.write(`   ${file}: ${count} found, ${limit} allowed by the baseline\n`);
        violations.get(file).forEach((line) => process.stderr.write(`     ${line}\n`));
      }
      if (rule.annotatable !== false) {
        process.stderr.write('   A legitimate use may be annotated: // policy-allow <rule>: <reason>\n');
      }
    }
    if (shrunk.length > 0) {
      failed = true;
      process.stderr.write(`❌ [${ruleName}] Fewer violations than the baseline records — lock in the progress:\n`);
      shrunk.forEach(({ file, count, limit }) => process.stderr.write(`   ${file}: ${count} found, baseline says ${limit}\n`));
      process.stderr.write('   Run: npm run lint:policy -- --update-baseline\n');
    }
    if (grown.length === 0 && shrunk.length === 0) {
      const total = [...violations.values()].reduce((sum, lines) => sum + lines.length, 0);
      process.stdout.write(`✅ [${ruleName}] passed (${total} baselined violation(s) remaining)\n`);
    }
  }

  if (updateBaseline && !failed) {
    writeBaseline(baseline);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(2);
});
