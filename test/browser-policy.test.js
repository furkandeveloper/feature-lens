// Phase 3E: browser coverage that did not run must never look like coverage
// that passed. Runs the browser suite with no Chrome in both modes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.js';

function runBrowserSuite(env) {
  // Run as a top-level test process, not as a child of this one's runner.
  const base = { ...process.env };
  delete base.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(ROOT, 'test/interactive-browser.test.js')], {
    encoding: 'utf8',
    env: { ...base, CHROME_PATH: path.join(ROOT, 'no-such-chrome'), FEATURELENS_REQUIRE_BROWSER: '', ...env },
  });
  const count = (k) => Number(r.stdout.match(new RegExp(`^# ${k} (\\d+)$`, 'm'))?.[1]);
  return { status: r.status, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'), out: r.stdout };
}

test('without Chrome, every browser test is reported as skipped, none as passed', () => {
  const r = runBrowserSuite({});
  assert.equal(r.status, 0);
  assert.ok(r.tests > 0);
  assert.deepEqual({ pass: r.pass, fail: r.fail, skipped: r.skipped }, { pass: 0, fail: 0, skipped: r.tests });
  assert.match(r.out, /# SKIP no Chrome or Chromium found/);
});

test('with FEATURELENS_REQUIRE_BROWSER=1 and no Chrome, every browser test fails', () => {
  const r = runBrowserSuite({ FEATURELENS_REQUIRE_BROWSER: '1' });
  assert.equal(r.status, 1);
  assert.deepEqual({ pass: r.pass, fail: r.fail, skipped: r.skipped }, { pass: 0, fail: r.tests, skipped: 0 });
  assert.match(r.out, /browser tests required/);
});
