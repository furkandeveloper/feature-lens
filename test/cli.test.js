import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, SAMPLE_REPO, SAMPLE_MANIFEST, sampleManifest, tempDir } from './helpers.js';

const CLI = path.join(ROOT, 'bin/featurelens.js');
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('validate exits 0 for a valid manifest', () => {
  const r = cli('validate', SAMPLE_MANIFEST, '--repo', SAMPLE_REPO);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /is valid/);
});

test('validate exits 1 and reports errors for an invalid manifest', (t) => {
  const m = sampleManifest();
  m.evidence[0].file = '../outside.js';
  const file = path.join(tempDir(t), 'm.json');
  fs.writeFileSync(file, JSON.stringify(m));

  const r = cli('validate', file, '--repo', SAMPLE_REPO, '--json');
  assert.equal(r.status, 1);
  const result = JSON.parse(r.stdout);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].path, '/evidence/0/file');
});

test('validate exits 1 for unreadable or malformed files', (t) => {
  const file = path.join(tempDir(t), 'bad.json');
  fs.writeFileSync(file, '{ nope');
  assert.equal(cli('validate', file).status, 1);
  assert.equal(cli('validate', path.join(ROOT, 'missing.json')).status, 1);
});

test('usage errors exit 2', () => {
  assert.equal(cli().status, 2);
  assert.equal(cli('frobnicate').status, 2);
  assert.equal(cli('validate').status, 2);
  assert.equal(cli('validate', SAMPLE_MANIFEST, '--unknown').status, 2);
});

test('git-info prints JSON metadata', (t) => {
  const r = cli('git-info', '--repo', tempDir(t));
  assert.equal(r.status, 0, r.stderr);
  const info = JSON.parse(r.stdout);
  assert.equal(info.tool.name, 'featurelens');
  assert.equal(info.repository.isGitRepo, false);
  assert.deepEqual(info.contributors, []);
});

test('--version prints the package version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(cli('--version').stdout.trim(), pkg.version);
});
