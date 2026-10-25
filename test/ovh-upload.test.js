const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('OVH upload preparation', () => {
  const revision = 'a'.repeat(40);
  let root;
  let release;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wampums-upload-'));
    release = path.join(root, 'releases', revision);
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'bin/df'), `#!/usr/bin/env bash
if [[ "$1" == -Pk ]]; then
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
  printf 'test 100 0 %s 0%% /\\n' "$AVAILABLE_KIB"
else
  echo 'Disk diagnostics'
fi
`, { mode: 0o700 });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function prepare(availableKib = '10', commit = revision, bytes = '1024') {
    return spawnSync('bash', [path.join(__dirname, '../deploy/ovh/prepare-upload.sh'), commit, bytes], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        WAMPUMS_ROOT: root,
        AVAILABLE_KIB: availableKib,
      },
    });
  }

  test('a writable release with enough space accepts an upload without leaving probe files', () => {
    const result = prepare();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(fs.readdirSync(release)).toEqual([]);
  });

  test('insufficient space rejects an upload and reports the required and available bytes', () => {
    const result = prepare('0');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('need 1024 bytes; available 0 bytes');
    expect(fs.readdirSync(release)).toEqual([]);
  });

  test.each([
    ['invalid revision', 'main; echo unsafe', '1024'],
    ['invalid archive size', revision, '1; echo unsafe'],
    ['empty archive', revision, '0'],
  ])('%s is rejected before creating a release', (_statement, commit, bytes) => {
    expect(prepare('10', commit, bytes).status).not.toBe(0);
    expect(fs.existsSync(path.join(root, 'releases'))).toBe(false);
  });

  (process.getuid?.() === 0 ? test.skip : test)('an existing archive owned by another account is rejected before upload', () => {
    fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(release, 'image.tar.gz'), 'partial archive', { mode: 0o400 });
    const result = prepare();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not writable by the deployment account');
    expect(fs.readFileSync(path.join(release, 'image.tar.gz'), 'utf8')).toBe('partial archive');
  });
});
