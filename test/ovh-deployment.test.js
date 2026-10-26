const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('OVH release activation', () => {
  const revision = 'a'.repeat(40);
  const previousImage = `wampums:${'b'.repeat(40)}`;
  let root;
  let release;
  let commandLog;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wampums-ovh-'));
    release = path.join(root, 'releases', revision);
    const previous = path.join(root, 'releases', 'previous');
    fs.mkdirSync(release, { recursive: true });
    fs.mkdirSync(previous);
    fs.mkdirSync(path.join(root, 'bin'));
    fs.copyFileSync(path.join(__dirname, '../deploy/ovh/deploy.sh'), path.join(release, 'deploy.sh'));
    fs.writeFileSync(path.join(release, 'compose.yml'), '');
    fs.writeFileSync(path.join(previous, 'compose.yml'), '');
    fs.writeFileSync(path.join(release, 'image.tar.gz'), 'fake image');
    fs.writeFileSync(path.join(root, '.env'), 'APP_DOMAINS=example.test');
    fs.writeFileSync(path.join(root, 'app.env'), 'DATABASE_URL=redacted');
    fs.writeFileSync(path.join(root, 'current-image'), previousImage);
    fs.symlinkSync(previous, path.join(root, 'current'));
    commandLog = path.join(root, 'commands');
    fs.writeFileSync(path.join(root, 'bin/docker'), `#!/usr/bin/env bash
printf '%s %s\\n' "$WAMPUMS_IMAGE" "$*" >> "$COMMAND_LOG"
if [[ "$*" == 'image ls '* ]]; then
  if [[ "$FAIL_IMAGE_LIST" == true ]]; then exit 1; fi
  printf '%s\\n' "$IMAGE_LIST"
fi
if [[ "$*" == 'image rm '* && "$FAIL_IMAGE_REMOVE" == true ]]; then
  exit 1
fi
if [[ "$*" == *'run --rm --no-deps app npm run db:migrate:deploy'* && "$FAIL_MIGRATION" == true ]]; then
  exit 1
fi
if [[ "$*" == *'up -d --no-deps --wait'*app && "$WAMPUMS_IMAGE" == "$CANDIDATE_IMAGE" && "$FAIL_HEALTH" == true ]]; then
  exit 1
fi
`, { mode: 0o700 });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function deploy(overrides = {}, commit = revision) {
    return spawnSync('bash', [path.join(release, 'deploy.sh'), commit], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        WAMPUMS_ROOT: root,
        COMMAND_LOG: commandLog,
        CANDIDATE_IMAGE: `wampums:${revision}`,
        ...overrides,
      },
    });
  }

  test('a healthy release becomes current only after migrations and health checks pass', () => {
    const result = deploy();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(fs.readlinkSync(path.join(root, 'current'))).toBe(release);
    expect(fs.readFileSync(path.join(root, 'current-image'), 'utf8').trim()).toBe(`wampums:${revision}`);
    const commands = fs.readFileSync(commandLog, 'utf8');
    expect(commands.indexOf('stop app')).toBeLessThan(commands.indexOf('db:migrate:deploy'));
    expect(commands.indexOf('db:migrate:deploy')).toBeLessThan(commands.indexOf('up -d'));
    expect(fs.existsSync(path.join(release, 'image.tar.gz'))).toBe(false);
  });

  test.each([
    ['a failed migration restores the previous app without activating the new release', { FAIL_MIGRATION: 'true' }],
    ['an unhealthy app restores the previous app without activating the new release', { FAIL_HEALTH: 'true' }],
  ])('%s', (_statement, failure) => {
    const result = deploy(failure);
    expect(result.status).not.toBe(0);
    expect(fs.readFileSync(path.join(root, 'current-image'), 'utf8')).toBe(previousImage);
    expect(fs.readlinkSync(path.join(root, 'current'))).not.toBe(release);
    const commands = fs.readFileSync(commandLog, 'utf8').trim().split('\n');
    expect(commands.at(-1)).toContain(`${previousImage} compose`);
    expect(commands.at(-1)).toContain('app caddy');
    expect(result.stderr).toContain('Database migrations are not reversed automatically');
    expect(commands.some((command) => command.includes('image rm'))).toBe(false);
    expect(fs.existsSync(path.join(release, 'image.tar.gz'))).toBe(false);
  });

  test('an invalid revision is rejected before Docker is invoked', () => {
    expect(deploy({}, 'main; echo unsafe').status).not.toBe(0);
    expect(fs.existsSync(commandLog)).toBe(false);
  });

  test('cleanup keeps the active image and three previous images, including an older immediate predecessor', () => {
    const images = ['a', 'c', 'd', 'e', 'b', 'f'].map((letter) => `wampums:${letter.repeat(40)}`);
    const result = deploy({ IMAGE_LIST: [...images, 'postgres:18-bookworm', 'wampums:latest'].join('\n') });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const commands = fs.readFileSync(commandLog, 'utf8').trim().split('\n');
    expect(commands.filter((command) => command.includes('image rm'))).toEqual([
      `wampums:${revision} image rm ${images[3]}`,
      `wampums:${revision} image rm ${images[5]}`,
    ]);
    expect(commands.findIndex((command) => command.includes('image ls')))
      .toBeGreaterThan(commands.findIndex((command) => command.endsWith('caddy')));
  });

  test('a retention file can limit cleanup to two previous images', () => {
    fs.writeFileSync(path.join(root, 'image-retention'), '2\n');
    const images = ['a', 'b', 'c', 'd'].map((letter) => `wampums:${letter.repeat(40)}`);
    expect(deploy({ IMAGE_LIST: images.join('\n') }).status).toBe(0);
    const commands = fs.readFileSync(commandLog, 'utf8');
    expect(commands).toContain(`image rm ${images[3]}`);
    expect(commands).not.toContain(`image rm ${images[2]}`);
  });

  test.each([{ FAIL_IMAGE_LIST: 'true' }, { FAIL_IMAGE_REMOVE: 'true' }])(
    'a cleanup failure leaves the healthy release active', (failure) => {
      const result = deploy({
        WAMPUMS_PREVIOUS_IMAGES: '1',
        IMAGE_LIST: `wampums:${'c'.repeat(40)}`,
        ...failure,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Release is active, but image cleanup was incomplete.');
      expect(result.stderr).not.toContain('attempting to restore');
      expect(fs.readFileSync(path.join(root, 'current-image'), 'utf8').trim()).toBe(`wampums:${revision}`);
      expect(fs.readlinkSync(path.join(root, 'current'))).toBe(release);
    },
  );

  test('invalid retention is rejected before stopping the app or loading an image', () => {
    fs.writeFileSync(path.join(root, 'image-retention'), '0');
    expect(deploy().status).not.toBe(0);
    expect(fs.existsSync(commandLog)).toBe(false);
  });
});
