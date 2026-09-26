import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getRepositoryInfo, getCurrentUser, getContributors, redactCredentials } from '../src/git/metadata.js';
import { tempDir } from './helpers.js';

before(() => {
  // Isolate from the developer's global/system git config.
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});

function run(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function commitAs(cwd, name, email, file, content) {
  fs.writeFileSync(path.join(cwd, file), content);
  run(cwd, 'add', file);
  run(cwd, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `edit ${file}`);
}

function initRepo(t) {
  const dir = tempDir(t);
  run(dir, 'init', '-q', '-b', 'main');
  return dir;
}

test('outside a git repository, reports that plainly', (t) => {
  const dir = tempDir(t);
  const info = getRepositoryInfo(dir);
  assert.equal(info.isGitRepo, false);
  assert.equal(info.name, path.basename(dir));
  assert.equal(info.commit, undefined);
});

test('reads branch, commit, dirty state and redacted remote', (t) => {
  const dir = initRepo(t);
  commitAs(dir, 'Ada', 'ada@example.com', 'a.txt', '1');
  run(dir, 'remote', 'add', 'origin', 'https://user:ghp_secret@github.com/acme/shop.git');

  let info = getRepositoryInfo(dir);
  assert.equal(info.isGitRepo, true);
  assert.equal(info.branch, 'main');
  assert.match(info.commit, /^[0-9a-f]{40}$/);
  assert.equal(info.dirty, false);
  assert.equal(info.remoteUrl, 'https://github.com/acme/shop.git');
});

test('dirty covers tracked modifications, deletions and untracked files, but not ignored files', (t) => {
  const dir = initRepo(t);
  commitAs(dir, 'Ada', 'ada@example.com', '.gitignore', 'build.log\n');
  commitAs(dir, 'Ada', 'ada@example.com', 'a.txt', '1');
  const dirty = () => getRepositoryInfo(dir).dirty;

  assert.equal(dirty(), false, 'clean');
  fs.writeFileSync(path.join(dir, 'build.log'), 'x');
  assert.equal(dirty(), false, 'ignored file');

  fs.writeFileSync(path.join(dir, 'a.txt'), '2');
  assert.equal(dirty(), true, 'tracked modification');
  run(dir, 'checkout', '--', 'a.txt');

  fs.rmSync(path.join(dir, 'a.txt'));
  assert.equal(dirty(), true, 'deleted tracked file');
  run(dir, 'checkout', '--', 'a.txt');

  fs.writeFileSync(path.join(dir, 'new.js'), '1');
  assert.equal(dirty(), true, 'untracked file');
});

test('handles a repository with no commits', (t) => {
  const dir = initRepo(t);
  const info = getRepositoryInfo(dir);
  assert.equal(info.isGitRepo, true);
  assert.equal(info.commit, undefined);
});

test('current user comes from git config and omits email by default', (t) => {
  const dir = initRepo(t);
  assert.deepEqual(getCurrentUser(dir), { source: 'unknown' });

  run(dir, 'config', 'user.name', 'Ada Lovelace');
  run(dir, 'config', 'user.email', 'ada@example.com');
  assert.deepEqual(getCurrentUser(dir), { name: 'Ada Lovelace', source: 'git-config' });
  assert.deepEqual(getCurrentUser(dir, { includeEmail: true }), { name: 'Ada Lovelace', email: 'ada@example.com', source: 'git-config' });
});

test('contributors are counted per file set, ordered by commits, never labeled as GitHub logins', (t) => {
  const dir = initRepo(t);
  commitAs(dir, 'Ada', 'ada@example.com', 'pay.js', '1');
  commitAs(dir, 'Grace', 'grace@example.com', 'pay.js', '2');
  commitAs(dir, 'Grace', 'grace@example.com', 'pay.js', '3');
  commitAs(dir, 'Linus', 'linus@example.com', 'other.js', '1');

  const contributors = getContributors(dir, ['pay.js']);
  assert.deepEqual(contributors, [
    { name: 'Grace', commits: 2, source: 'git-log' },
    { name: 'Ada', commits: 1, source: 'git-log' },
  ]);
  assert.ok(contributors.every((c) => !('githubLogin' in c)));

  assert.deepEqual(getContributors(dir, ['pay.js'], { includeEmail: true, limit: 1 }), [
    { name: 'Grace', email: 'grace@example.com', commits: 2, source: 'git-log' },
  ]);
  assert.deepEqual(getContributors(dir, []), []);
});

test('redactCredentials only strips userinfo from http(s) URLs', () => {
  assert.equal(redactCredentials('https://tok@github.com/a/b.git'), 'https://github.com/a/b.git');
  assert.equal(redactCredentials('git@github.com:a/b.git'), 'git@github.com:a/b.git');
});
