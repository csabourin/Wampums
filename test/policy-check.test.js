/**
 * scripts/modernization/check-policy.js
 *
 * The policy checks are a ratchet: a file may never gain a violation, a fixed
 * violation must be removed from the baseline, and a legitimate use is
 * annotated with a reason instead of being baselined.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'modernization', 'check-policy.js');

let workspace;
let baselinePath;

function writeSource(relativePath, contents) {
  const target = path.join(workspace, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function runPolicy(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...process.env, POLICY_BASELINE_PATH: baselinePath },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-check-'));
  baselinePath = path.join(workspace, 'policy-baseline.json');
  fs.writeFileSync(baselinePath, JSON.stringify({
    'role-names': {}, 'client-org-id': {}, 'manual-auth': {}, 'catch-shadow': {}, 'eslint-warnings': {},
  }));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('role-names', () => {
  test.each([
    ["if (req.user.roleNames.includes('district')) {}"],
    ["const ok = rows.some((r) => r.role_name === 'district');"],
    ["const sql = `SELECT id FROM roles WHERE role_name = 'parent'`;"],
    ["const sql = `AND r.role_name IN ('district', 'unitadmin')`;"],
  ])('flags %s', (line) => {
    writeSource('routes/sample.js', `${line}\n`);

    const { status, output } = runPolicy('role-names');

    expect(status).toBe(1);
    expect(output).toContain('routes/sample.js:1');
  });

  test('ignores parameterized role lookups and comments', () => {
    writeSource('routes/sample.js', [
      "// roleNames.includes('district') used to be checked here",
      "const sql = 'SELECT id FROM roles WHERE role_name = $1';",
    ].join('\n'));

    expect(runPolicy('role-names').status).toBe(0);
  });

  test('flags hasRole calls in the SPA but not its definition', () => {
    writeSource('spa/utils/PermissionUtils.js', "export function hasRole(name) { return name === 'x'; }\n");
    writeSource('spa/page.js', "if (hasRole('district')) { show(); }\n");

    const { status, output } = runPolicy('role-names');

    expect(status).toBe(1);
    expect(output).toContain('spa/page.js:1');
    expect(output).not.toContain('PermissionUtils');
  });
});

describe('client-org-id', () => {
  test('flags client-supplied organization ids outside the resolvers', () => {
    writeSource('routes/sample.js', [
      'const a = req.query.organization_id;',
      'const b = req.body?.organization_id;',
      "const c = req.headers['x-organization-id'];",
    ].join('\n'));

    const { status, output } = runPolicy('client-org-id');

    expect(status).toBe(1);
    expect(output).toContain('3 found, 0 allowed');
  });

  test('leaves the two organization resolvers alone', () => {
    writeSource('middleware/auth.js', "const h = req.headers['x-organization-id'];\n");
    writeSource('utils/api-helpers.js', "const h = req.headers['x-organization-id'];\n");

    expect(runPolicy('client-org-id').status).toBe(0);
  });
});

describe('manual-auth', () => {
  test('flags hand-rolled token and membership checks in routes', () => {
    writeSource('routes/sample.js', [
      'const payload = verifyJWT(token);',
      'const ok = await verifyOrganizationMembership(pool, id, org, {});',
      'const org = await getCurrentOrganizationId(req, pool, logger);',
    ].join('\n'));

    const { status, output } = runPolicy('manual-auth');

    expect(status).toBe(1);
    expect(output).toContain('3 found, 0 allowed');
  });
});

describe('catch-shadow', () => {
  test('flags error(res, ...) inside catch (error) when error is the helper', () => {
    writeSource('routes/sample.js', [
      "const { success, error } = require('../middleware/response');",
      'async function handler(req, res) {',
      '  try {',
      '    await work();',
      '  } catch (error) {',
      "    return error(res, 'Failed', 500);",
      '  }',
      '}',
    ].join('\n'));

    const { status, output } = runPolicy('catch-shadow');

    expect(status).toBe(1);
    expect(output).toContain('routes/sample.js:6');
  });

  test('accepts catch (err) and files without the helper', () => {
    writeSource('routes/renamed.js', [
      "const { error } = require('../middleware/response');",
      "try { work(); } catch (err) { error(res, 'Failed', 500); }",
    ].join('\n'));
    writeSource('services/other.js', 'try { work(); } catch (error) { report(error); }\n');

    expect(runPolicy('catch-shadow').status).toBe(0);
  });
});

describe('annotations', () => {
  test('a policy-allow with a reason on the line above exempts the line', () => {
    writeSource('routes/sample.js', [
      '// policy-allow client-org-id: the switch endpoint validates membership',
      'const id = req.body.organization_id;',
    ].join('\n'));

    expect(runPolicy('client-org-id').status).toBe(0);
  });

  test('a policy-allow without a reason does not', () => {
    writeSource('routes/sample.js', [
      '// policy-allow client-org-id:',
      'const id = req.body.organization_id;',
    ].join('\n'));

    expect(runPolicy('client-org-id').status).toBe(1);
  });

  test('an allow for another rule does not', () => {
    writeSource('routes/sample.js', [
      '// policy-allow role-names: unrelated',
      'const id = req.body.organization_id;',
    ].join('\n'));

    expect(runPolicy('client-org-id').status).toBe(1);
  });
});

describe('baseline ratchet', () => {
  test('passes on recorded violations and fails on a new one', () => {
    writeSource('routes/sample.js', 'const a = req.query.organization_id;\n');
    fs.writeFileSync(baselinePath, JSON.stringify({ 'client-org-id': { 'routes/sample.js': 1 } }));

    expect(runPolicy('client-org-id').status).toBe(0);

    writeSource('routes/sample.js', 'const a = req.query.organization_id;\nconst b = req.query.organization_id;\n');
    expect(runPolicy('client-org-id').status).toBe(1);
  });

  test('refuses to raise a recorded baseline', () => {
    writeSource('routes/sample.js', 'const a = req.query.organization_id;\n');

    const { status, output } = runPolicy('client-org-id', '--update-baseline');

    expect(status).toBe(1);
    expect(output).toContain('Refusing to raise the baseline');
    expect(JSON.parse(fs.readFileSync(baselinePath, 'utf8'))['client-org-id']).toEqual({});
  });

  test('requires the baseline to be lowered after a fix, then accepts it', () => {
    writeSource('routes/sample.js', 'const ok = true;\n');
    fs.writeFileSync(baselinePath, JSON.stringify({ 'client-org-id': { 'routes/sample.js': 1 } }));

    const stale = runPolicy('client-org-id');
    expect(stale.status).toBe(1);
    expect(stale.output).toContain('lock in the progress');

    expect(runPolicy('client-org-id', '--update-baseline').status).toBe(0);
    expect(JSON.parse(fs.readFileSync(baselinePath, 'utf8'))['client-org-id']).toEqual({});
    expect(runPolicy('client-org-id').status).toBe(0);
  });
});

describe('eslint-warnings', () => {
  beforeEach(() => {
    writeSource('eslint.config.js', "module.exports = [{ rules: { 'no-magic-numbers': ['warn', { ignore: [0, 1] }] } }];\n");
  });

  test('fails when a file gains a warning, naming it', () => {
    writeSource('routes/sample.js', 'setTimeout(() => {}, 3600);\n');

    const { status, output } = runPolicy('eslint-warnings');

    expect(status).toBe(1);
    expect(output).toContain('routes/sample.js:1: No magic number: 3600. [no-magic-numbers]');
  });

  test('passes on the warnings the baseline records, and asks to lower it after a fix', () => {
    writeSource('routes/sample.js', 'setTimeout(() => {}, 3600);\n');
    fs.writeFileSync(baselinePath, JSON.stringify({ 'eslint-warnings': { 'routes/sample.js': 1 } }));

    expect(runPolicy('eslint-warnings').status).toBe(0);

    writeSource('routes/sample.js', 'const DELAY_MS = 3600;\nsetTimeout(() => {}, DELAY_MS);\n');
    const fixed = runPolicy('eslint-warnings');
    expect(fixed.status).toBe(1);
    expect(fixed.output).toContain('lock in the progress');
  });
});
