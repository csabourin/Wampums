#!/usr/bin/env node
/**
 * Says which dismissed Dependabot alerts have become fixable.
 *
 * An alert listed in .github/dependabot-dismissed.json was dismissed because no
 * fix could be installed: none was published, or the only one lies outside the
 * range a dependent requires (image-size 2.x under metro's ^1.0.2). An alert is
 * fixable once the registry holds a version outside the advisory's vulnerable
 * ranges, newer than the installed copies, that every dependent in the lockfile
 * accepts. A downgrade below a vulnerable range is not a fix. npm resolves the range,
 * so the check needs no semver library: a 404 from `npm view` means no such
 * version exists.
 *
 * Prints a Markdown report of the fixable alerts (nothing when there are none)
 * and exits 0. Exits 1 when the advisory database or the registry cannot be read.
 *
 * Usage: node scripts/security/check-dismissed-advisories.js [list.json]
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..', '..');
const LIST_FILE = path.join(ROOT, '.github', 'dependabot-dismissed.json');
const ADVISORY_API = 'https://api.github.com/advisories/';
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'devDependencies'];
const NEGATED_OPERATOR = { '>=': '<', '>': '<=', '<=': '>', '<': '>=' };

/**
 * The versions a vulnerable range does not cover, as semver disjuncts.
 * @param {string} vulnerableRange - Advisory range, e.g. ">= 0.6.3, <= 2.0.2"
 * @returns {string[]} Disjuncts whose union is the complement, e.g. ["<0.6.3", ">2.0.2"]
 */
function complementOf(vulnerableRange) {
  return vulnerableRange.split(',').flatMap((comparator) => {
    const match = comparator.trim().match(/^(>=|<=|>|<|=)?\s*(\S+)$/);
    if (!match) {
      throw new Error(`Unreadable advisory range: ${vulnerableRange}`);
    }
    const [, operator = '=', version] = match;
    return operator === '='
      ? [`<${version}`, `>${version}`]
      : [`${NEGATED_OPERATOR[operator]}${version}`];
  });
}

/**
 * A range matching the versions the dependent accepts, newer than every installed
 * copy, that no advisory range covers.
 * @param {string} dependentRange - Range from the lockfile, e.g. "^1.0.2"
 * @param {string[]} vulnerableRanges - Every advisory range for the package
 * @param {string[]} installed - Versions of the package in the lockfile
 * @returns {string} A semver range, a disjunction of conjunctions
 */
function safeRangeWithin(dependentRange, vulnerableRanges, installed) {
  const newer = installed.map((version) => `>${version}`).join(' ');
  const combinations = vulnerableRanges.reduce(
    (partial, range) => partial.flatMap((prefix) => complementOf(range).map((part) => `${prefix} ${part}`)),
    dependentRange.split('||').map((part) => `${part.trim()} ${newer}`)
  );
  return combinations.join(' || ');
}

/**
 * @param {string} manifest - Lockfile path relative to the repository
 * @param {string} name - Package name
 * @returns {{ranges: string[], installed: string[]}} The distinct ranges that the
 *   lockfile's packages require of it, and the versions installed
 */
function lockfileUsage(manifest, name) {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, manifest), 'utf8'));
  const ranges = new Set();
  const installed = new Set();
  Object.entries(lock.packages || {}).forEach(([location, entry]) => {
    if (location.endsWith(`node_modules/${name}`)) {
      installed.add(entry.version);
    }
    DEPENDENCY_FIELDS.forEach((field) => {
      const range = entry[field]?.[name];
      if (range) {
        ranges.add(range);
      }
    });
  });
  return { ranges: [...ranges], installed: [...installed] };
}

/**
 * @param {string} name - Package name
 * @param {string} range - Semver range
 * @returns {Promise<string[]>} Published versions in the range
 */
async function publishedVersions(name, range) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', `${name}@${range}`, 'version', '--json']);
    const versions = JSON.parse(stdout || '[]');
    return Array.isArray(versions) ? versions : [versions];
  } catch (failure) {
    const code = JSON.parse(failure.stdout || '{}').error?.code;
    if (code === 'E404') {
      return [];
    }
    throw failure;
  }
}

/**
 * @param {string} ghsa - Advisory id
 * @returns {Promise<Object>} The advisory from GitHub's public database
 */
async function fetchAdvisory(ghsa) {
  const headers = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${ADVISORY_API}${ghsa}`, { headers });
  if (!response.ok) {
    throw new Error(`Advisory ${ghsa} could not be read: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * @param {{alert: number, ghsa: string, package: string, manifest: string}} entry
 * @returns {Promise<string|null>} A report line when the alert should come back
 */
async function check(entry) {
  const advisory = await fetchAdvisory(entry.ghsa);
  if (advisory.withdrawn_at) {
    return `- #${entry.alert} \`${entry.package}\` (${entry.manifest}): ${entry.ghsa} was withdrawn; close the alert and remove its entry.`;
  }
  const vulnerableRanges = (advisory.vulnerabilities || [])
    .filter((item) => item.package?.ecosystem === 'npm' && item.package?.name === entry.package)
    .map((item) => item.vulnerable_version_range);
  const { ranges, installed } = lockfileUsage(entry.manifest, entry.package);
  if (vulnerableRanges.length === 0 || ranges.length === 0) {
    return `- #${entry.alert} \`${entry.package}\` (${entry.manifest}): no longer affected (not in the advisory or no longer in the lockfile); close the alert and remove its entry.`;
  }
  const fixes = await Promise.all(ranges.map((range) => publishedVersions(entry.package, safeRangeWithin(range, vulnerableRanges, installed))));
  if (fixes.some((versions) => versions.length === 0)) {
    return null;
  }
  const newest = fixes.map((versions) => versions[versions.length - 1]);
  return `- #${entry.alert} \`${entry.package}\` (${entry.manifest}): fixed in ${[...new Set(newest)].join(', ')}, within ${ranges.join(', ')}. Reopen with \`gh api -X PATCH repos/{owner}/{repo}/dependabot/alerts/${entry.alert} -f state=open\`.`;
}

async function main() {
  const { alerts } = JSON.parse(fs.readFileSync(process.argv[2] || LIST_FILE, 'utf8'));
  const lines = (await Promise.all(alerts.map(check))).filter(Boolean);
  if (lines.length > 0) {
    console.log(['Dismissed Dependabot alerts that can now be fixed:', '', ...lines].join('\n'));
  }
}

main().catch((failure) => {
  console.error(failure.message);
  process.exit(1);
});
