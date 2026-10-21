/**
 * The repository has no submodules. A gitlink committed by accident (an agent
 * worktree under .claude/worktrees) has no URL in .gitmodules, and the deploy
 * job's checkout fails on it, so no release reaches the server.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const GITLINK_MODE = '160000';

test('no submodule or nested checkout is tracked, so the deploy checkout succeeds', () => {
  const entries = execFileSync('git', ['ls-files', '--stage'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).split('\n');
  const gitlinks = entries.filter((line) => line.startsWith(`${GITLINK_MODE} `));
  expect(gitlinks).toEqual([]);
});
