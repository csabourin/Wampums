/*
 * wampums-restart: recreating the app on the VPS so it rereads app.env.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '../deploy/ovh/restart.sh');

describe('OVH app restart', () => {
  const image = `wampums:${'c'.repeat(40)}`;
  let root;
  let release;
  let commandLog;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wampums-restart-'));
    release = path.join(root, 'releases', 'c'.repeat(40));
    fs.mkdirSync(release, { recursive: true });
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(release, 'compose.yml'), '');
    fs.writeFileSync(path.join(root, '.env'), 'APP_DOMAINS=example.test');
    fs.writeFileSync(path.join(root, 'current-image'), `${image}\n`);
    fs.symlinkSync(release, path.join(root, 'current'));
    commandLog = path.join(root, 'commands');
    fs.writeFileSync(path.join(root, 'bin/docker'), `#!/usr/bin/env bash
printf '%s %s %s\\n' "$WAMPUMS_ROOT" "$WAMPUMS_IMAGE" "$*" >> "$COMMAND_LOG"
`, { mode: 0o700 });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const restart = () => spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, WAMPUMS_ROOT: root, COMMAND_LOG: commandLog },
  });

  test('the app container is recreated from the active release, so it reads app.env again', () => {
    const result = restart();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const commands = fs.readFileSync(commandLog, 'utf8').trim().split('\n');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBe(`${root} ${image} compose --project-name wampums --env-file ${root}/.env `
      + `-f ${release}/compose.yml up -d --no-deps --force-recreate --wait --wait-timeout 180 app`);
    expect(result.stdout).toContain(`Restarted ${image}`);
  });

  test('without a readable active release, nothing is restarted', () => {
    fs.rmSync(path.join(root, 'current-image'));
    const result = restart();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(`No active release under ${root}\n`);
    expect(fs.existsSync(commandLog)).toBe(false);
  });

  // root opens any file, so this case only exists for other accounts.
  (process.getuid?.() === 0 ? test.skip : test)('run without sudo, it says so instead of failing on a file it cannot open', () => {
    fs.writeFileSync(path.join(root, 'deploy.lock'), '', { mode: 0o000 });
    const result = restart();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(`Cannot open ${root}/deploy.lock (run with sudo?)\n`);
    expect(fs.existsSync(commandLog)).toBe(false);
  });

  test('during a deployment, the restart refuses before reading a release the deployment may be replacing', () => {
    fs.rmSync(path.join(root, 'current-image'));
    const lock = path.join(root, 'deploy.lock');
    fs.writeFileSync(lock, '');
    const holder = spawnSync('bash', ['-c', `exec 9>"${lock}"; flock -n 9 && bash "${SCRIPT}"`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, WAMPUMS_ROOT: root, COMMAND_LOG: commandLog },
    });
    expect(holder.status).not.toBe(0);
    expect(holder.stderr).toContain('A deployment is running');
    expect(holder.stderr).not.toContain('No active release');
    expect(fs.existsSync(commandLog)).toBe(false);
  });
});
