import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, DEFAULT_CONFIG, ConfigError } from '../src/config/config.js';
import { tempDir } from './helpers.js';

function withConfig(t, content) {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, '.featurelens.json'), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}

test('missing config yields defaults', (t) => {
  assert.deepEqual(loadConfig(tempDir(t)), DEFAULT_CONFIG);
});

test('partial config merges over defaults', (t) => {
  const dir = withConfig(t, { outputDir: 'docs/lens/', attribution: { includeEmail: true } });
  assert.deepEqual(loadConfig(dir), {
    outputDir: 'docs/lens',
    attribution: { includeEmail: true, includeContributors: true, maxContributors: 20 },
  });
});

test('rejects invalid JSON, unknown keys and wrong types', (t) => {
  assert.throws(() => loadConfig(withConfig(t, '{')), ConfigError);
  assert.throws(() => loadConfig(withConfig(t, { outpuDir: 'x' })), /outpuDir is not an allowed property/);
  assert.throws(() => loadConfig(withConfig(t, { attribution: { includeEmail: 'yes' } })), /must be of type boolean/);
});

test('rejects output directories outside the repository', (t) => {
  for (const outputDir of ['/tmp/docs', '../docs', 'docs/../../x', 'docs\\x']) {
    assert.throws(() => loadConfig(withConfig(t, { outputDir })), /outputDir must be/, outputDir);
  }
});

test('an unreadable .featurelens.json is a ConfigError, not a crash (Phase 3E)', (t) => {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, '.featurelens.json'));
  assert.throws(() => loadConfig(dir), (e) => e instanceof ConfigError && /\.featurelens\.json: cannot read/.test(e.message));
});
