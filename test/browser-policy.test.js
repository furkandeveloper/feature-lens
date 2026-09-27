// Phase 3E: browser coverage that did not run must never look like coverage
// that passed. Runs the browser suite with no Chrome in both modes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.js';

const SUITES = ['test/interactive-browser.test.js', 'test/layout-browser.test.js'];

function runBrowserSuite(env, suite) {
  // Run as a top-level test process, not as a child of this one's runner.
  const base = { ...process.env };
  delete base.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(ROOT, suite)], {
    encoding: 'utf8',
    env: { ...base, CHROME_PATH: path.join(ROOT, 'no-such-chrome'), FEATURELENS_REQUIRE_BROWSER: '', ...env },
  });
  const count = (k) => Number(r.stdout.match(new RegExp(`^# ${k} (\\d+)$`, 'm'))?.[1]);
  return { status: r.status, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'), out: r.stdout };
}

for (const suite of SUITES) {
  test(`${suite}: without Chrome, every browser test is reported as skipped, none as passed`, () => {
    const r = runBrowserSuite({}, suite);
    assert.equal(r.status, 0);
    assert.ok(r.tests > 0);
    assert.deepEqual({ pass: r.pass, fail: r.fail, skipped: r.skipped }, { pass: 0, fail: 0, skipped: r.tests });
    assert.match(r.out, /# SKIP no Chrome or Chromium found/);
  });

  test(`${suite}: with FEATURELENS_REQUIRE_BROWSER=1 and no Chrome, every browser test fails`, () => {
    const r = runBrowserSuite({ FEATURELENS_REQUIRE_BROWSER: '1' }, suite);
    assert.equal(r.status, 1);
    assert.deepEqual({ pass: r.pass, fail: r.fail, skipped: r.skipped }, { pass: 0, fail: r.tests, skipped: 0 });
    assert.match(r.out, /browser tests required/);
  });
}
