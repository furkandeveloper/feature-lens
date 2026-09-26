import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../src/validation/validate.js';
import { sampleManifest, issues } from './helpers.js';

const A = 'aaaaaaa';
const B = 'bbbbbbb';
const C = 'ccccccc';
const errorsOf = (m) => issues(validateManifest(m).errors);

/** The sample manifest as if analyzed under git: created at A, updated at B. */
function withRevisions() {
  const m = sampleManifest();
  m.history[0].revision = A;
  m.history[1].previousRevision = A;
  m.history[1].revision = B;
  m.metadata.repository.revision = B;
  return m;
}

describe('update history', () => {
  test('an unbroken revision chain is valid', () => {
    assert.deepEqual(errorsOf(withRevisions()), []);
  });

  test('the first entry is the only creation', () => {
    const m = sampleManifest();
    m.history[0].action = 'updated';
    m.history[1].action = 'created';
    assert.deepEqual(errorsOf(m), ['history.action /history/0/action', 'history.action /history/1/action']);
  });

  test('entries are chronological and agree with metadata timestamps', () => {
    const m = sampleManifest();
    m.history[1].at = '2026-09-23T18:00:00Z';
    assert.deepEqual(errorsOf(m), ['history.order /history/1/at', 'history.timestamps /metadata/updatedAt']);

    const m2 = sampleManifest();
    m2.metadata.generatedAt = '2026-09-22T00:00:00Z';
    assert.deepEqual(errorsOf(m2), ['history.timestamps /metadata/generatedAt']);
  });

  test('timestamps compare by instant, not by spelling', () => {
    const m = sampleManifest();
    m.metadata.updatedAt = '2026-09-23T22:15:00+02:00';
    assert.deepEqual(errorsOf(m), []);
  });

  test('revision chain: previousRevision matches the prior entry, the last entry matches the repository', () => {
    const m = withRevisions();
    m.history[1].previousRevision = C;
    assert.deepEqual(errorsOf(m), ['history.revision-chain /history/1/previousRevision']);

    const m2 = withRevisions();
    delete m2.history[1].previousRevision;
    assert.deepEqual(errorsOf(m2), ['history.revision-chain /history/1/previousRevision']);

    const m3 = withRevisions();
    m3.metadata.repository.revision = C;
    assert.deepEqual(errorsOf(m3), ['history.revision-chain /metadata/repository/revision']);

    const m4 = withRevisions();
    m4.history[0].previousRevision = C;
    assert.deepEqual(errorsOf(m4), ['history.revision-chain /history/0/previousRevision']);
  });

  test('recorded validation results must be self-consistent', () => {
    const m = sampleManifest();
    m.history[1].validation.errorCount = 2;
    m.history[0].validation = { valid: false, errorCount: 0, warningCount: 0, evidenceChecked: false };
    assert.deepEqual(errorsOf(m), ['history.validation /history/0/validation', 'history.validation /history/1/validation']);
  });

  test('malformed entries are schema errors', () => {
    const m = sampleManifest();
    delete m.history[1].by;
    m.history[1].id = 'Update 2';
    m.history[1].changedFiles = ['../outside.js'];
    m.history[1].revision = 'not-a-sha';
    m.history[1].validation.warningCount = -1;
    assert.deepEqual(errorsOf(m), [
      'schema.minimum /history/1/validation/warningCount',
      'schema.pattern /history/1/changedFiles/0',
      'schema.pattern /history/1/id',
      'schema.pattern /history/1/revision',
      'schema.required /history/1',
    ]);
  });

  test('history needs at least one entry and unique ids', () => {
    const m = sampleManifest();
    m.history = [];
    assert.deepEqual(errorsOf(m), ['schema.minItems /history']);

    const m2 = sampleManifest();
    m2.history[1].id = 'h-1';
    assert.ok(errorsOf(m2).includes('id.duplicate /history/1/id'));
  });
});
