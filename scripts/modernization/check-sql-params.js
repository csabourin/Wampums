/**
 * check-sql-params.js
 *
 * Detects likely SQL injection candidates where pool.query uses a template literal
 * with inline JavaScript interpolation (${...}).
 */

const { spawnSync } = require('child_process');

const scanPaths = ['routes', 'utils', 'services', 'middleware'];
const pattern = String.raw`pool\.query\(\s*\`[^\`]*\$\{`;

const result = spawnSync('rg', ['--pcre2', pattern, ...scanPaths], {
  encoding: 'utf8'
});

if (result.status === 2) {
  console.error('❌ Failed to run SQL parameterization check.');
  if (result.stderr) {
    console.error(result.stderr.trim());
  }
  process.exit(2);
}

const output = result.stdout ? result.stdout.trim() : '';
if (output) {
  console.error(output);
  console.error('❌ Non-parameterized SQL candidate found.');
  process.exit(1);
}

console.log('✅ SQL parameterization check passed.');
