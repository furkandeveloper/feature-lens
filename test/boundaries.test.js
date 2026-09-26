import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import * as gitMetadata from '../src/git/metadata.js';

function sources(dir = path.join(ROOT, 'src')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : [[path.relative(ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')]];
  });
}

test('FeatureLens does not discover repositories or model Claude as a callable analyzer', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/repo')), false);
  assert.deepEqual(Object.keys(gitMetadata).sort(), ['getContributors', 'getCurrentUser', 'getRepositoryInfo', 'git', 'redactCredentials']);
  for (const [file, text] of sources()) {
    for (const name of ['listSourceFiles', 'getChangedFiles', 'FeatureAnalyzer', 'RepositoryContext', 'DocumentationUpdater', 'UpdatePlan']) {
      assert.ok(!text.includes(name), `${file} mentions ${name}`);
    }
  }
});

test('only output/writer.js writes files and only git/metadata.js runs processes', () => {
  for (const [file, text] of sources()) {
    if (file !== 'src/output/writer.js') {
      assert.ok(!/writeFileSync|renameSync|mkdirSync|rmSync|unlinkSync|appendFileSync|copyFileSync|cpSync|createWriteStream|openSync|fs\/promises/.test(text), `${file} writes files`);
    }
    if (file !== 'src/git/metadata.js') assert.ok(!/child_process/.test(text), `${file} runs processes`);
  }
});

test('nothing in src or bin uses the network or references external URLs', () => {
  const files = [...sources(), ['bin/featurelens.js', fs.readFileSync(path.join(ROOT, 'bin/featurelens.js'), 'utf8')]];
  for (const [file, text] of files) {
    assert.ok(!/node:(?:http|https|http2|net|tls|dns|dgram)\b|\bfetch\(|WebSocket/.test(text), `${file} uses the network`);
    assert.ok(!/(?:https?|wss?):\/\//.test(text), `${file} contains an external URL`);
  }
});

test('no runtime dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
