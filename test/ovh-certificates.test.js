const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('OVH certificate renewal', () => {
  let root;
  let lineage;
  let tls;
  let reloadLog;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wampums-tls-'));
    lineage = path.join(root, 'renewed');
    tls = path.join(root, 'active');
    reloadLog = path.join(root, 'reload');
    for (const directory of [lineage, tls, path.join(root, 'bin')]) {
      fs.mkdirSync(directory);
    }
    fs.writeFileSync(path.join(tls, 'fullchain.pem'), 'previous certificate');
    fs.writeFileSync(path.join(tls, 'privkey.pem'), 'previous key');
    fs.writeFileSync(path.join(lineage, 'fullchain.pem'), 'renewed certificate');
    fs.writeFileSync(path.join(root, 'bin', 'docker'), `#!/usr/bin/env bash
set -eu
if [[ "$1" == ps ]]; then
  echo running-container
else
  test "$(cat "$WAMPUMS_TLS_DIR/fullchain.pem")" = 'renewed certificate'
  test "$(cat "$WAMPUMS_TLS_DIR/privkey.pem")" = 'renewed key'
  echo reloaded > "$RELOAD_LOG"
fi
`, { mode: 0o700 });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function renew() {
    return spawnSync('bash', [path.join(__dirname, '../deploy/ovh/certbot-deploy-hook.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        RENEWED_LINEAGE: lineage,
        WAMPUMS_TLS_DIR: tls,
        RELOAD_LOG: reloadLog,
      },
    });
  }

  test('an incomplete renewal leaves the active certificate pair untouched', () => {
    expect(renew().status).not.toBe(0);
    expect(fs.readFileSync(path.join(tls, 'fullchain.pem'), 'utf8')).toBe('previous certificate');
    expect(fs.readFileSync(path.join(tls, 'privkey.pem'), 'utf8')).toBe('previous key');
    expect(fs.existsSync(reloadLog)).toBe(false);
  });

  test('the server reloads only after the renewed certificate and private key are installed', () => {
    fs.writeFileSync(path.join(lineage, 'privkey.pem'), 'renewed key');
    const result = renew();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(fs.readFileSync(reloadLog, 'utf8')).toBe('reloaded\n');
    expect(fs.statSync(path.join(tls, 'privkey.pem')).mode & 0o777).toBe(0o600);
  });
});
